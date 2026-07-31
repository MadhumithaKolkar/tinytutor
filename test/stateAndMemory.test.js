const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readState, writeState, defaultState } = require("../src/lib/state");
const { readMemory, writeMemory } = require("../src/lib/memory");
const { questionCountFor, buildQuizInstruction } = require("../src/lib/promptTemplate");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-state-"));
}

test("readState returns null when uninitialized", () => {
  const dir = tempDir();
  assert.equal(readState(dir), null);
});

test("state round-trips through disk", () => {
  const dir = tempDir();
  const state = defaultState("abc123");
  state.quizPending = true;
  writeState(dir, state);

  const read = readState(dir);
  assert.equal(read.checkpointRef, "abc123");
  assert.equal(read.quizPending, true);
  assert.equal(read.config.linesThreshold, 80);
});

test("readMemory returns a valid default shape when uninitialized", () => {
  const dir = tempDir();
  const memory = readMemory(dir);
  assert.deepEqual(memory.milestones, []);
  assert.deepEqual(memory.weakTopics, []);
});

test("memory round-trips through disk", () => {
  const dir = tempDir();
  const memory = readMemory(dir);
  memory.weakTopics.push("async/await error handling");
  writeMemory(dir, memory);

  const read = readMemory(dir);
  assert.deepEqual(read.weakTopics, ["async/await error handling"]);
});

test("questionCountFor stays within 3-10 bounds", () => {
  assert.equal(questionCountFor(0), 3);
  assert.equal(questionCountFor(50), 4);
  assert.equal(questionCountFor(10000), 10);
});

test("buildQuizInstruction includes file list and question count", () => {
  const diff = {
    filesChanged: 2,
    insertions: 100,
    deletions: 10,
    totalChangedLines: 110,
    changedFiles: ["src/foo.js", "src/bar.js"],
    totalChangedFilesCount: 2,
    diffText: "diff --git a/src/foo.js b/src/foo.js",
    diffTruncated: false,
  };
  const instruction = buildQuizInstruction({ diff, weakTopics: ["closures"], memoryRelativePath: ".tinytutor/memory.json" });

  assert.match(instruction, /src\/foo\.js/);
  assert.match(instruction, /closures/);
  assert.match(instruction, /\.tinytutor\/memory\.json/);
  assert.match(instruction, /5 question/); // 3 + floor(110/50) = 5
});
