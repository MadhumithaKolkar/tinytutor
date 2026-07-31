const path = require("path");
const { isGitRepo, currentHead, EMPTY_TREE } = require("../lib/gitDiff");
const { readState, writeState, defaultState } = require("../lib/state");
const { readMemory, writeMemory, memoryPath } = require("../lib/memory");
const { ensureHookInstalled, writeSettings, settingsPath } = require("../lib/settingsMerge");
const { BANNER } = require("../lib/banner");

function init(argv) {
  const projectRoot = process.cwd();

  if (!isGitRepo(projectRoot)) {
    console.error(
      "tinytutor: this doesn't look like a git repository.\n" +
        "Milestone detection is based on `git diff`, so run `git init` first, then re-run `tinytutor init`."
    );
    process.exitCode = 1;
    return;
  }

  const force = argv.includes("--force");

  let state = readState(projectRoot);
  if (!state || force) {
    const checkpoint = currentHead(projectRoot);
    state = defaultState(checkpoint === EMPTY_TREE ? EMPTY_TREE : checkpoint);
    writeState(projectRoot, state);
    console.log(`Checkpoint set at current HEAD (${checkpoint.slice(0, 12)}).`);
  } else {
    console.log("Existing .tinytutor/state.json found — leaving checkpoint as-is (use --force to reset).");
  }

  const memory = readMemory(projectRoot);
  writeMemory(projectRoot, memory);

  const { changed, settings } = ensureHookInstalled(projectRoot);
  if (changed) {
    writeSettings(projectRoot, settings);
    console.log(`Registered the Stop hook in ${path.relative(projectRoot, settingsPath(projectRoot))}.`);
  } else {
    console.log("Stop hook already registered — nothing to change there.");
  }

  console.log(BANNER);
  console.log(`
tinytutor is set up for this project.

- Checkpoint + settings live in .tinytutor/ and .claude/settings.json
- Quiz history lives in ${path.relative(projectRoot, memoryPath(projectRoot))}
- Defaults: quiz triggers after ~${state.config.linesThreshold} changed lines or ${state.config.filesThreshold} changed files since the last check-in (edit .tinytutor/state.json's "config" to tune)

Nothing else to run — the next time Claude Code finishes a substantial chunk of work in this project, it'll quiz you before handing back control.
`);
}

module.exports = { init };
