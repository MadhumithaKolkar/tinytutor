const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// git's magic empty-tree object, used as a diff base when there is no prior checkpoint commit.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// Where tinytutor parks its own snapshot commits so `git gc` never reaps
// them. These commits never touch any branch, HEAD, or the user's index.
const CHECKPOINT_REF = "refs/tinytutor/checkpoint";

const MAX_DIFF_CHARS = 6000;
const MAX_FILES_LISTED = 20;

// tinytutor's own bookkeeping files shouldn't count toward the diff that
// triggers a quiz about the user's code.
const BASE_PATHSPEC = [".", ":(exclude).tinytutor", ":(exclude).claude"];

function buildPathspec(customExcludes = []) {
  const pathspec = [...BASE_PATHSPEC];
  if (Array.isArray(customExcludes)) {
    for (const pattern of customExcludes) {
      if (pattern && typeof pattern === "string") {
        pathspec.push(`:(exclude)${pattern}`);
      }
    }
  }
  return pathspec;
}

function run(args, cwd, env) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
    env: env ? { ...process.env, ...env } : process.env,
    // Without this, execFileSync inherits stderr straight to the terminal,
    // so an expected/handled failure (e.g. `rev-parse HEAD` on a repo with
    // no commits yet, caught by currentHead()'s try/catch) still leaks a
    // raw "fatal: ..." line to the user even though nothing actually failed
    // from their point of view.
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function isGitRepo(cwd) {
  try {
    return run(["rev-parse", "--is-inside-work-tree"], cwd).trim() === "true";
  } catch {
    return false;
  }
}

function currentHead(cwd) {
  try {
    return run(["rev-parse", "HEAD"], cwd).trim();
  } catch {
    // No commits yet.
    return EMPTY_TREE;
  }
}

function refExists(ref, cwd) {
  if (ref === EMPTY_TREE) return true;
  try {
    run(["cat-file", "-e", ref], cwd);
    return true;
  } catch {
    return false;
  }
}

// Parses `git diff --shortstat` output, e.g.:
// " 3 files changed, 45 insertions(+), 12 deletions(-)"
function parseShortstat(text) {
  const filesMatch = text.match(/(\d+) files? changed/);
  const insMatch = text.match(/(\d+) insertions?\(\+\)/);
  const delMatch = text.match(/(\d+) deletions?\(-\)/);
  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}

// Captures the ENTIRE current working tree (tracked, modified, untracked —
// anything not gitignored) as a real git commit object, without touching the
// user's actual index, working tree, HEAD, or branch. This is what lets us
// diff against "everything as of last quiz" even when most of it was never
// committed. The commit is parented on `parentRef` so a plain `git diff
// parentRef newSnapshot` captures the full delta, uncommitted files included.
//
// Implementation note: git only reads/writes the *real* index at
// `.git/index` when GIT_INDEX_FILE isn't set. Pointing GIT_INDEX_FILE at a
// throwaway temp file means `git add -A` builds an index purely in scratch
// space — the user's staged changes are never touched.
function snapshotWorkingTree(cwd, parentRef) {
  const tmpIndex = path.join(os.tmpdir(), `tinytutor-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    run(["add", "-A"], cwd, env);
    const tree = run(["write-tree"], cwd, env).trim();
    const commitEnv = {
      ...env,
      GIT_AUTHOR_NAME: "tinytutor",
      GIT_AUTHOR_EMAIL: "tinytutor@localhost",
      GIT_COMMITTER_NAME: "tinytutor",
      GIT_COMMITTER_EMAIL: "tinytutor@localhost",
    };
    const parentArgs = parentRef === EMPTY_TREE ? [] : ["-p", parentRef];
    const commit = run(["commit-tree", tree, ...parentArgs, "-m", "tinytutor checkpoint"], cwd, commitEnv).trim();
    return commit;
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

// Points refs/tinytutor/checkpoint at `sha` so git's garbage collector never
// reclaims it while it's the active checkpoint (it isn't reachable from any
// branch otherwise).
function protectCheckpoint(cwd, sha) {
  try {
    run(["update-ref", CHECKPOINT_REF, sha], cwd);
  } catch {
    // Non-fatal — worst case the object is eventually gc'd and we self-heal
    // by resetting the checkpoint (see diffSinceCheckpoint).
  }
}

// Computes the diff between a checkpoint ref and the current working tree
// (including uncommitted and untracked changes), by snapshotting the working
// tree into an ephemeral commit and diffing checkpointRef against it. Returns
// null if git is unavailable or the checkpoint ref no longer resolves (e.g.
// its object was pruned).
function diffSinceCheckpoint(checkpointRef, cwd, customExcludes = []) {
  if (!isGitRepo(cwd)) return null;
  if (!refExists(checkpointRef, cwd)) return null;

  const snapshotRef = snapshotWorkingTree(cwd, checkpointRef);
  const pathspec = buildPathspec(customExcludes);

  const shortstat = run(["diff", "--shortstat", "--no-ext-diff", checkpointRef, snapshotRef, "--", ...pathspec], cwd).trim();
  const stat = parseShortstat(shortstat);

  let changedFiles = [];
  try {
    changedFiles = run(["diff", "--name-only", "--no-ext-diff", checkpointRef, snapshotRef, "--", ...pathspec], cwd)
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    changedFiles = [];
  }

  let diffText = "";
  let truncated = false;
  try {
    diffText = run(["diff", "--no-color", "--no-ext-diff", checkpointRef, snapshotRef, "--", ...pathspec], cwd);
    if (diffText.length > MAX_DIFF_CHARS) {
      diffText = diffText.slice(0, MAX_DIFF_CHARS);
      truncated = true;
    }
  } catch {
    diffText = "";
  }

  return {
    ...stat,
    changedFiles: changedFiles.slice(0, MAX_FILES_LISTED),
    totalChangedFilesCount: changedFiles.length,
    diffText,
    diffTruncated: truncated,
    totalChangedLines: stat.insertions + stat.deletions,
    snapshotRef,
  };
}

module.exports = {
  EMPTY_TREE,
  CHECKPOINT_REF,
  isGitRepo,
  currentHead,
  refExists,
  parseShortstat,
  snapshotWorkingTree,
  protectCheckpoint,
  diffSinceCheckpoint,
  buildPathspec,
};
