const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  diffSinceCheckpoint,
  currentHead,
  isGitRepo,
  parseShortstat,
  snapshotWorkingTree,
  protectCheckpoint,
  EMPTY_TREE,
} = require("../src/lib/gitDiff");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-test-"));
  git(["init", "-q"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  return dir;
}

test("parseShortstat extracts files/insertions/deletions", () => {
  const stat = parseShortstat(" 3 files changed, 45 insertions(+), 12 deletions(-)");
  assert.equal(stat.filesChanged, 3);
  assert.equal(stat.insertions, 45);
  assert.equal(stat.deletions, 12);
});

test("parseShortstat handles insertions-only diffs", () => {
  const stat = parseShortstat(" 1 file changed, 5 insertions(+)");
  assert.equal(stat.filesChanged, 1);
  assert.equal(stat.insertions, 5);
  assert.equal(stat.deletions, 0);
});

test("isGitRepo returns false outside a repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-nogit-"));
  assert.equal(isGitRepo(dir), false);
});

test("currentHead falls back to EMPTY_TREE when there are no commits", () => {
  const dir = makeTempRepo();
  assert.equal(currentHead(dir), EMPTY_TREE);
});

test("diffSinceCheckpoint detects changes from the empty tree on first commit", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\nline2\nline3\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);

  const diff = diffSinceCheckpoint(EMPTY_TREE, dir);
  assert.ok(diff);
  assert.equal(diff.filesChanged, 1);
  assert.equal(diff.insertions, 3);
  assert.deepEqual(diff.changedFiles, ["a.txt"]);
});

test("diffSinceCheckpoint includes uncommitted working-tree changes", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  const checkpoint = currentHead(dir);

  fs.writeFileSync(path.join(dir, "b.txt"), "new file\nsecond line\n");
  fs.appendFileSync(path.join(dir, "a.txt"), "line2\n");

  const diff = diffSinceCheckpoint(checkpoint, dir);
  assert.equal(diff.filesChanged, 2);
  assert.equal(diff.totalChangedFilesCount, 2);
  assert.ok(diff.changedFiles.includes("a.txt"));
  assert.ok(diff.changedFiles.includes("b.txt"));
});

test("diffSinceCheckpoint includes brand-new untracked files (never committed)", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  const checkpoint = currentHead(dir);

  fs.writeFileSync(path.join(dir, "new-untracked.js"), "const x = 1;\nconst y = 2;\n");

  const diff = diffSinceCheckpoint(checkpoint, dir);
  assert.ok(diff.changedFiles.includes("new-untracked.js"));
  assert.equal(diff.insertions, 2);
});

test("advancing the checkpoint via a snapshot makes the diff empty again (regression: checkpoint used to never move past uncommitted work)", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  const checkpoint = currentHead(dir);

  fs.writeFileSync(path.join(dir, "feature.js"), "function feature() { return 42; }\n");
  const diffBefore = diffSinceCheckpoint(checkpoint, dir);
  assert.equal(diffBefore.totalChangedFilesCount, 1);

  const snapshot = snapshotWorkingTree(dir, checkpoint);
  protectCheckpoint(dir, snapshot);

  const diffAfter = diffSinceCheckpoint(snapshot, dir);
  assert.equal(diffAfter.totalChangedFilesCount, 0);
  assert.equal(diffAfter.totalChangedLines, 0);
});

test("snapshotWorkingTree does not touch the real git index", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  const checkpoint = currentHead(dir);

  fs.writeFileSync(path.join(dir, "untracked.js"), "x\n");
  snapshotWorkingTree(dir, checkpoint);

  // The real index should still show untracked.js as untracked, not staged.
  const status = git(["status", "--porcelain"], dir);
  assert.match(status, /\?\? untracked\.js/);
});

test("diffSinceCheckpoint returns null for an unresolvable checkpoint ref", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);

  const diff = diffSinceCheckpoint("0000000000000000000000000000000000000000", dir);
  assert.equal(diff, null);
});
