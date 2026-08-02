const { readState, writeState } = require("../lib/state");
const { readMemory } = require("../lib/memory");
const { diffSinceCheckpoint } = require("../lib/gitDiff");

function quiz() {
  const projectRoot = process.cwd();
  const state = readState(projectRoot);

  if (!state) {
    console.error("tinytutor is not initialized here. Run `tinytutor init` first.");
    process.exitCode = 1;
    return;
  }

  const diff = diffSinceCheckpoint(state.checkpointRef, projectRoot, state.config?.excludePatterns);

  if (!diff || diff.totalChangedFilesCount === 0) {
    console.log("No code changes detected since last checkpoint. Nothing to quiz on right now!");
    return;
  }

  const memory = readMemory(projectRoot);
  state.quizPending = true;
  state.memoryCountAtBlock = memory.milestones.length;
  state.pendingQuizDiff = diff;
  state.denyCount = 0;
  writeState(projectRoot, state);

  console.log(`Quiz triggered manually for ${diff.totalChangedFilesCount} file(s) changed (+${diff.insertions}/-${diff.deletions} lines).`);
  console.log("The next time Claude Code attempts an edit or tool call, tinytutor will start the check-in!");
}

module.exports = { quiz };
