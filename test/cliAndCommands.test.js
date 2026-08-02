const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const { writeState, readState } = require("../src/lib/state");
const { writeMemory, readMemory } = require("../src/lib/memory");
const { buildPathspec } = require("../src/lib/gitDiff");
const { ensureHookInstalled, removeHookInstalled } = require("../src/lib/settingsMerge");

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-test-cli-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  return dir;
}

test("buildPathspec supports custom exclude patterns", () => {
  const spec = buildPathspec(["package-lock.json", "dist/*"]);
  assert.ok(spec.includes(":(exclude)package-lock.json"));
  assert.ok(spec.includes(":(exclude)dist/*"));
  assert.ok(spec.includes(":(exclude).tinytutor"));
});

test("writeState and writeMemory perform atomic file writes", () => {
  const repo = makeTempRepo();
  try {
    const initial = { checkpointRef: "HEAD", quizPending: false, config: {} };
    writeState(repo, initial);
    const loadedState = readState(repo);
    assert.equal(loadedState.checkpointRef, "HEAD");

    const memoryInitial = { milestones: [], weakTopics: ["testing"] };
    writeMemory(repo, memoryInitial);
    const loadedMemory = readMemory(repo);
    assert.deepEqual(loadedMemory.weakTopics, ["testing"]);

    // Ensure temp files were cleaned up
    const files = fs.readdirSync(path.join(repo, ".tinytutor"));
    const tmpFiles = files.filter((f) => f.includes(".tmp"));
    assert.equal(tmpFiles.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("removeHookInstalled cleans up tinytutor hooks without touching others", () => {
  const repo = makeTempRepo();
  try {
    const installed = ensureHookInstalled(repo);
    const { writeSettings } = require("../src/lib/settingsMerge");
    writeSettings(repo, installed.settings);

    const { changed, settings } = removeHookInstalled(repo);
    assert.equal(changed, true);
    assert.equal(settings.hooks?.Stop, undefined);
    assert.equal(settings.hooks?.PreToolUse, undefined);
    assert.equal(settings.hooks?.UserPromptSubmit, undefined);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
