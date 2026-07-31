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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-hook-"));
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

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".tinytutor", "state.json"), "utf8"));
}

function readMemory(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".tinytutor", "memory.json"), "utf8"));
}

function crossMilestone(dir) {
  fs.writeFileSync(path.join(dir, "a.js"), "1\n2\n3\n");
  fs.writeFileSync(path.join(dir, "b.js"), "1\n2\n3\n");
  fs.writeFileSync(path.join(dir, "c.js"), "1\n2\n3\n");
}

test("stop-hook ALWAYS exits 0 — it must never block, since Stop fires on every normal turn end", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);

  // Run it several times in a row, simulating repeated natural turn-ends
  // (e.g. Claude asking a question and waiting) — none of these should ever
  // block, unlike the old design.
  for (let i = 0; i < 5; i++) {
    const result = runStopHook(dir);
    assert.equal(result.status, 0, `call ${i} should exit 0, got ${result.status}`);
  }
});

test("stop-hook stashes the diff and marks quizPending when a milestone is crossed (writes nothing to stdout — that channel is inert in practice)", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);

  const result = runStopHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");

  const state = readState(dir);
  assert.equal(state.quizPending, true);
  assert.ok(state.pendingQuizDiff);
  assert.equal(state.pendingQuizDiff.totalChangedFilesCount, 3);
});

test("stop-hook does not re-advance the checkpoint until memory.json actually gains a milestone entry", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);
  const checkpointAfterMilestone = readState(dir).checkpointRef;

  // Calling again without memory.json changing should be a silent no-op.
  const second = runStopHook(dir);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, "");
  assert.equal(readState(dir).checkpointRef, checkpointAfterMilestone);
  assert.equal(readState(dir).quizPending, true);
});

test("stop-hook advances the checkpoint once memory.json gains a milestone entry", () => {
  const dir = makeRepo();
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir });
  crossMilestone(dir);
  runStopHook(dir);
  const checkpointBefore = readState(dir).checkpointRef;

  const memory = readMemory(dir);
  memory.milestones.push({ timestamp: new Date().toISOString(), filesChanged: ["a.js"], questionsAsked: [] });
  fs.writeFileSync(path.join(dir, ".tinytutor", "memory.json"), JSON.stringify(memory, null, 2));

  const result = runStopHook(dir);
  assert.equal(result.status, 0);

  const state = readState(dir);
  assert.equal(state.quizPending, false);
  assert.notEqual(state.checkpointRef, checkpointBefore);
});

test("stop-hook does nothing (exit 0, no output) when tinytutor was never initialized", () => {
  const dir = makeRepo();
  const result = runStopHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});
