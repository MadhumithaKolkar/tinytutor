const { readState } = require("../lib/state");
const { readMemory } = require("../lib/memory");
const { diffSinceCheckpoint } = require("../lib/gitDiff");

function status() {
  const projectRoot = process.cwd();
  const state = readState(projectRoot);

  if (!state) {
    console.log("tinytutor is not initialized here. Run `tinytutor init` first.");
    return;
  }

  const memory = readMemory(projectRoot);
  const diff = diffSinceCheckpoint(state.checkpointRef, projectRoot, state.config?.excludePatterns);

  console.log(`Checkpoint:      ${state.checkpointRef.slice(0, 12)}`);
  console.log(`Quiz pending:    ${state.quizPending}`);
  console.log(`Milestones hit:  ${state.milestoneCount || 0}`);
  console.log(
    `Since checkpoint: ${diff ? `${diff.totalChangedFilesCount} file(s), +${diff.insertions}/-${diff.deletions}` : "unavailable"}`
  );
  console.log(
    `Next trigger at:  ${state.config.linesThreshold} changed lines or ${state.config.filesThreshold} changed files`
  );
  console.log(`Weak topics:     ${memory.weakTopics.length ? memory.weakTopics.join(", ") : "(none yet)"}`);
  console.log(`Milestones logged in memory: ${memory.milestones.length}`);
}

module.exports = { status };
