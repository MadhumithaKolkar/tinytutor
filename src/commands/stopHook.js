const { readState, writeState } = require("../lib/state");
const { readMemory } = require("../lib/memory");
const { diffSinceCheckpoint, snapshotWorkingTree, protectCheckpoint, EMPTY_TREE } = require("../lib/gitDiff");

function readStdin() {
  try {
    const fs = require("fs");
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// IMPORTANT: this hook must always exit 0. `Stop` fires after every single
// assistant turn, including the completely normal case where Claude just
// asked a question and is legitimately waiting for the human to reply.
// Blocking it (exit 2) doesn't "pause and wait" — it prevents Claude Code
// from ever handing control back to the terminal at all, forcing Claude to
// regenerate immediately with no chance for the user to actually answer.
//
// This hook only detects milestones and stashes the diff for later — actual
// enforcement, and delivering the quiz content Claude reacts to, happens in
// preToolUseHook.js (a Stop hook's non-blocking stdout is silently ignored
// by Claude Code in practice, confirmed by testing against a real session).
function stopHook() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
    return;
  }

  const projectRoot = payload.cwd || process.cwd();
  const state = readState(projectRoot);

  if (!state) {
    process.exit(0);
    return;
  }

  if (state.quizPending) {
    // Check whether the quiz already wrapped up (memory.json gained an
    // entry) since it was issued, and advance the checkpoint if so.
    const memory = readMemory(projectRoot);
    if (memory.milestones.length > (state.memoryCountAtBlock || 0)) {
      const snapshot = snapshotWorkingTree(projectRoot, state.checkpointRef);
      protectCheckpoint(projectRoot, snapshot);
      state.checkpointRef = snapshot;
      state.quizPending = false;
      state.pendingQuizDiff = null;
      state.denyCount = 0;
      writeState(projectRoot, state);
    }
    process.exit(0);
    return;
  }

  const diff = diffSinceCheckpoint(state.checkpointRef, projectRoot);

  if (!diff) {
    // Git unavailable, or the checkpoint object was pruned/rewritten.
    // Self-heal by resetting the checkpoint to a fresh snapshot rather than
    // getting stuck.
    const snapshot = snapshotWorkingTree(projectRoot, EMPTY_TREE);
    protectCheckpoint(projectRoot, snapshot);
    state.checkpointRef = snapshot;
    writeState(projectRoot, state);
    process.exit(0);
    return;
  }

  const { linesThreshold, filesThreshold } = state.config;
  const milestoneReached =
    diff.totalChangedLines >= linesThreshold || diff.totalChangedFilesCount >= filesThreshold;

  if (!milestoneReached) {
    process.exit(0);
    return;
  }

  const memory = readMemory(projectRoot);

  state.quizPending = true;
  state.memoryCountAtBlock = memory.milestones.length;
  state.milestoneCount = (state.milestoneCount || 0) + 1;
  state.pendingQuizDiff = diff;
  state.denyCount = 0;
  writeState(projectRoot, state);

  process.exit(0);
}

module.exports = { stopHook };
