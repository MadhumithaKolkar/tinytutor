const fs = require("fs");
const path = require("path");

const STATE_VERSION = 1;

const DEFAULT_CONFIG = {
  linesThreshold: 80,
  filesThreshold: 3,
  excludePatterns: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
};

function tinytutorDir(projectRoot) {
  return path.join(projectRoot, ".tinytutor");
}

function statePath(projectRoot) {
  return path.join(tinytutorDir(projectRoot), "state.json");
}

function defaultState(checkpointRef) {
  return {
    version: STATE_VERSION,
    checkpointRef,
    quizPending: false,
    milestoneCount: 0,
    // How many milestones were already logged in memory.json when the
    // current quiz was issued. Once memory.milestones.length exceeds this,
    // the quiz is considered done (see stopHook.js / preToolUseHook.js).
    memoryCountAtBlock: 0,
    // The diff captured at the moment the milestone fired, reused by
    // preToolUseHook.js to build the actual quiz content — recomputing it
    // at block-time would be stale/wrong since the working tree may have
    // changed again by then (e.g. Claude mid-writing the next file).
    pendingQuizDiff: null,
    // How many times preToolUseHook.js has denied an edit for the CURRENT
    // pending quiz. If this climbs unreasonably high — Claude stuck in a
    // loop, or never writing memory.json for some reason — the hook gives
    // up and lets the edit through rather than deadlocking the session.
    denyCount: 0,
    config: { ...DEFAULT_CONFIG },
  };
}

function readState(projectRoot) {
  const file = statePath(projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...defaultState(parsed.checkpointRef),
      ...parsed,
      config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
    };
  } catch {
    return null;
  }
}

function writeState(projectRoot, state) {
  const dir = tinytutorDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = statePath(projectRoot);
  const tmp = path.join(dir, `state.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, target);
}

module.exports = { tinytutorDir, statePath, defaultState, readState, writeState, DEFAULT_CONFIG };
