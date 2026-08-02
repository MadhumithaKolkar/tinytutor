const fs = require("fs");
const path = require("path");

const STOP_HOOK_MARKER = "tinytutor stop-hook";
const STOP_HOOK_COMMAND = "npx --yes tinytutor stop-hook";

const PRE_TOOL_USE_HOOK_MARKER = "tinytutor pre-tool-use-hook";
const PRE_TOOL_USE_HOOK_COMMAND = "npx --yes tinytutor pre-tool-use-hook";
// Bash is included because Claude can otherwise route around the edit gate
// entirely (e.g. `rm file.py`, `sed -i`, shell redirection) without ever
// going through Edit/Write — confirmed happening in real testing. The hook
// itself only actually blocks Bash calls that look file-modifying (see
// preToolUseHook.js); read-only commands like `ls`/`git status`/`cat` pass
// through untouched.
const PRE_TOOL_USE_MATCHER = "Edit|Write|MultiEdit|NotebookEdit|Bash";

const USER_PROMPT_SUBMIT_HOOK_MARKER = "tinytutor user-prompt-submit-hook";
const USER_PROMPT_SUBMIT_HOOK_COMMAND = "npx --yes tinytutor user-prompt-submit-hook";

function settingsPath(projectRoot) {
  return path.join(projectRoot, ".claude", "settings.json");
}

function readSettings(projectRoot) {
  const file = settingsPath(projectRoot);
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function findHookEntry(settings, event, marker) {
  const entries = settings?.hooks?.[event];
  if (!Array.isArray(entries)) return null;
  return (
    entries.find(
      (entry) =>
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h) => typeof h?.command === "string" && h.command.includes(marker))
    ) || null
  );
}

function hasTinytutorHook(settings) {
  return findHookEntry(settings, "Stop", STOP_HOOK_MARKER) !== null;
}

// Idempotently ensures all tinytutor hooks are registered in
// .claude/settings.json, without disturbing any other settings or hooks
// already present in the file:
//   - Stop: non-blocking milestone detection (see stopHook.js)
//   - PreToolUse (Edit/Write/MultiEdit/NotebookEdit/Bash): blocks further
//     code changes while a quiz is open and unrecorded (see preToolUseHook.js)
//   - UserPromptSubmit: refreshes the format rules on every user reply during
//     an open quiz, since PreToolUse only fires on tool call attempts and
//     there usually aren't any between quiz questions (see userPromptSubmitHook.js)
// Re-running this (e.g. via `tinytutor init` on an upgrade) also syncs an
// existing PreToolUse entry's matcher forward if it's stale, so installs
// don't need a full --force reset just to pick up matcher changes.
// Returns { changed, settings }.
function ensureHookInstalled(projectRoot) {
  const settings = readSettings(projectRoot);
  let changed = false;

  if (!settings.hooks) settings.hooks = {};

  if (!findHookEntry(settings, "Stop", STOP_HOOK_MARKER)) {
    if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
    settings.hooks.Stop.push({
      hooks: [{ type: "command", command: STOP_HOOK_COMMAND, timeout: 600 }],
    });
    changed = true;
  }

  const preToolUseEntry = findHookEntry(settings, "PreToolUse", PRE_TOOL_USE_HOOK_MARKER);
  if (!preToolUseEntry) {
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
    settings.hooks.PreToolUse.push({
      matcher: PRE_TOOL_USE_MATCHER,
      hooks: [{ type: "command", command: PRE_TOOL_USE_HOOK_COMMAND, timeout: 30 }],
    });
    changed = true;
  } else if (preToolUseEntry.matcher !== PRE_TOOL_USE_MATCHER) {
    preToolUseEntry.matcher = PRE_TOOL_USE_MATCHER;
    changed = true;
  }

  if (!findHookEntry(settings, "UserPromptSubmit", USER_PROMPT_SUBMIT_HOOK_MARKER)) {
    if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];
    settings.hooks.UserPromptSubmit.push({
      hooks: [{ type: "command", command: USER_PROMPT_SUBMIT_HOOK_COMMAND, timeout: 20 }],
    });
    changed = true;
  }

  return { changed, settings };
}

function writeSettings(projectRoot, settings) {
  const dir = path.join(projectRoot, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(projectRoot), JSON.stringify(settings, null, 2) + "\n", "utf8");
}

module.exports = {
  settingsPath,
  readSettings,
  hasTinytutorHook,
  ensureHookInstalled,
  writeSettings,
  STOP_HOOK_MARKER,
  PRE_TOOL_USE_HOOK_MARKER,
  PRE_TOOL_USE_MATCHER,
  USER_PROMPT_SUBMIT_HOOK_MARKER,
};
