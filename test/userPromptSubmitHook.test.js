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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-ups-"));
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

function runUserPromptSubmitHook(dir, userPrompt = "some reply") {
  return spawnSync(process.execPath, [CLI, "user-prompt-submit-hook"], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, user_prompt: userPrompt }),
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

test("user-prompt-submit-hook does nothing when there is no pending quiz", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });

  const result = runUserPromptSubmitHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("user-prompt-submit-hook injects a compact reminder via additionalContext while a quiz is open", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir); // sets quizPending = true

  const result = runUserPromptSubmitHook(dir, "I think it's because of X");
  assert.equal(result.status, 0);

  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(output.hookSpecificOutput.additionalContext, /Think of it like/);
  assert.match(output.hookSpecificOutput.additionalContext, /bullet/i);
  // Must stay compact — it fires on every message during the quiz, so it
  // should not repeat the full diff.
  assert.ok(output.hookSpecificOutput.additionalContext.length < 1500);
});

test("user-prompt-submit-hook stops injecting once the quiz is completed", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);

  const memory = readMemory(dir);
  memory.milestones.push({ timestamp: new Date().toISOString(), filesChanged: ["a.js"], questionsAsked: [] });
  fs.writeFileSync(path.join(dir, ".tinytutor", "memory.json"), JSON.stringify(memory, null, 2));

  const result = runUserPromptSubmitHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("user-prompt-submit-hook does nothing when tinytutor was never initialized", () => {
  const dir = makeRepo();
  const result = runUserPromptSubmitHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});
