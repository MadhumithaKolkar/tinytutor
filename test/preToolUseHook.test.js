const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "tinytutor.js");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-pretooluse-"));
  git(["init", "-q"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  return dir;
}

function runStopHook(dir) {
  return spawnSync(process.execPath, [CLI, "stop-hook"], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir }),
    encoding: "utf8",
  });
}

function runPreToolUseHook(dir, { toolName = "Write", filePath, command } = {}) {
  const tool_input = {};
  if (filePath) tool_input.file_path = filePath;
  if (command) tool_input.command = command;
  return spawnSync(process.execPath, [CLI, "pre-tool-use-hook"], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, tool_name: toolName, tool_input }),
    encoding: "utf8",
  });
}

function readMemory(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".tinytutor", "memory.json"), "utf8"));
}

function crossMilestone(dir) {
  fs.writeFileSync(path.join(dir, "a.js"), "1\n2\n3\n");
  fs.writeFileSync(path.join(dir, "b.js"), "1\n2\n3\n");
  fs.writeFileSync(path.join(dir, "c.js"), "1\n2\n3\n");
}

test("pre-tool-use-hook allows edits (exit 0) when there is no pending quiz", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });

  const result = runPreToolUseHook(dir);
  assert.equal(result.status, 0);
});

test("pre-tool-use-hook denies further edits with a SHORT visible reason (Claude Code always displays permissionDecisionReason verbatim to the user, confirmed in real testing) and puts the actual quiz content in additionalContext instead", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir); // issues the quiz, sets quizPending = true, stashes the diff

  const result = runPreToolUseHook(dir, { filePath: path.join(dir, "d.js") });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");

  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");

  // The visible reason must stay short — it's shown to the user as-is.
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.length < 100);
  assert.doesNotMatch(output.hookSpecificOutput.permissionDecisionReason, /a\.js/);

  // The real quiz content lives in additionalContext, not the visible reason.
  assert.match(output.hookSpecificOutput.additionalContext, /tinytutor :\)/);
  assert.match(output.hookSpecificOutput.additionalContext, /a\.js/); // one of the files from the stashed diff
  assert.match(output.hookSpecificOutput.additionalContext, /question/i);
});

test("pre-tool-use-hook exempts writes to memory.json itself, so Claude can always close out the quiz", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);

  const memoryFilePath = path.join(dir, ".tinytutor", "memory.json");
  const result = runPreToolUseHook(dir, { filePath: memoryFilePath });
  assert.equal(result.status, 0);
});

test("pre-tool-use-hook allows edits again once memory.json shows the quiz was completed", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);

  const memory = readMemory(dir);
  memory.milestones.push({ timestamp: new Date().toISOString(), filesChanged: ["a.js"], questionsAsked: [] });
  fs.writeFileSync(path.join(dir, ".tinytutor", "memory.json"), JSON.stringify(memory, null, 2));

  const result = runPreToolUseHook(dir, { filePath: path.join(dir, "d.js") });
  assert.equal(result.status, 0);
});

test("pre-tool-use-hook does nothing when tinytutor was never initialized", () => {
  const dir = makeRepo();
  const result = runPreToolUseHook(dir, { filePath: path.join(dir, "d.js") });
  assert.equal(result.status, 0);
});

test("pre-tool-use-hook blocks a destructive Bash command (regression: Claude routed around the Edit/Write gate via `rm` in real testing)", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);

  const result = runPreToolUseHook(dir, { toolName: "Bash", command: "rm notes.md" });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("pre-tool-use-hook leaves harmless Bash commands alone even while a quiz is open", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);

  for (const command of ["ls -la", "git status", "cat README.md", "npm test", "grep -r foo ."]) {
    const result = runPreToolUseHook(dir, { toolName: "Bash", command });
    assert.equal(result.status, 0, `expected "${command}" to pass through, got status ${result.status}`);
    assert.equal(result.stdout, "", `expected no output for "${command}"`);
  }
});

test("pre-tool-use-hook gives up after MAX_DENY_COUNT denials, force-closing the quiz rather than deadlocking forever (regression: a real session asked a 4th unbounded question with no cap)", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);

  let last;
  for (let i = 0; i < 20; i++) {
    last = runPreToolUseHook(dir, { filePath: path.join(dir, "d.js") });
  }

  assert.equal(last.status, 0);
  assert.equal(last.stdout, ""); // allowed through, not another deny
  const memory = readMemory(dir);
  assert.equal(memory.milestones.length, 1);
  assert.equal(memory.milestones[0].autoClosed, true);
});
