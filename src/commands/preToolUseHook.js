const path = require("path");
const { readState, writeState } = require("../lib/state");
const { readMemory, writeMemory, memoryPath } = require("../lib/memory");
const { buildQuizInstruction, buildFallbackReminder } = require("../lib/promptTemplate");

// Safety valve: if a single pending quiz has caused this many denies without
// memory.json ever gaining an entry, stop trusting Claude to close it out on
// its own and force it closed instead — better a quiz that's cut short than
// a session that deadlocks forever on every subsequent edit attempt.
const MAX_DENY_COUNT = 12;

function readStdin() {
  try {
    const fs = require("fs");
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function targetsMemoryFile(payload, projectRoot) {
  const candidate = payload?.tool_input?.file_path || payload?.tool_input?.notebook_path;
  if (!candidate) return false;
  return path.resolve(projectRoot, candidate) === memoryPath(projectRoot);
}

// Best-effort heuristic: matches shell commands that plausibly modify or
// delete files (rm, mv, sed -i, redirection, destructive git ops, ...).
// This is a bypass patch for a real gap found in testing — Claude routing
// around the Edit/Write gate entirely via `rm file.py` — not a security
// boundary. A sufficiently unusual command can still slip through; this
// covers the common cases without blocking harmless reads (ls, cat, git
// status, grep, npm test, etc.), which would otherwise make Bash unusable
// while a quiz is open.
const FILE_MODIFYING_BASH = /\b(rm|mv|sed\s+-i|truncate|dd|tee)\b|>>?(?!\s*&)|git\s+(rm|mv|checkout\s+--|reset\s+--hard|clean\b)/;

function isFileModifyingBash(command) {
  return typeof command === "string" && FILE_MODIFYING_BASH.test(command);
}

// PreToolUse IS safely blockable without the Stop-hook problem: it fires
// before a specific tool call, not at every turn boundary, so blocking it
// doesn't prevent the human from ever getting a turn. This is where the
// actual "you can't just keep coding past an open quiz" enforcement lives,
// and it's also the only channel confirmed to actually reach Claude — so the
// full quiz content (not just a reminder) is delivered here.
function preToolUseHook() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
    return;
  }

  const projectRoot = payload.cwd || process.cwd();
  const state = readState(projectRoot);

  if (!state || !state.quizPending) {
    process.exit(0);
    return;
  }

  // Bash is matched too (see settingsMerge.js), but only actually gate
  // commands that look file-modifying — leave reads/tests/status checks
  // alone so a pending quiz doesn't make the whole shell unusable.
  if (payload.tool_name === "Bash" && !isFileModifyingBash(payload?.tool_input?.command)) {
    process.exit(0);
    return;
  }

  // Always allow the write that actually closes out the quiz — otherwise
  // Claude could never satisfy the condition this hook is blocking on.
  if (targetsMemoryFile(payload, projectRoot)) {
    process.exit(0);
    return;
  }

  const memory = readMemory(projectRoot);
  const quizCompleted = memory.milestones.length > (state.memoryCountAtBlock || 0);

  if (quizCompleted) {
    process.exit(0);
    return;
  }

  const denyCount = (state.denyCount || 0) + 1;

  if (denyCount > MAX_DENY_COUNT) {
    // Force the quiz closed rather than deadlocking every future edit.
    memory.milestones.push({
      timestamp: new Date().toISOString(),
      filesChanged: state.pendingQuizDiff?.changedFiles || [],
      questionsAsked: [],
      autoClosed: true,
    });
    writeMemory(projectRoot, memory);
    state.quizPending = false;
    state.pendingQuizDiff = null;
    state.denyCount = 0;
    writeState(projectRoot, state);
    process.exit(0);
    return;
  }

  state.denyCount = denyCount;
  writeState(projectRoot, state);

  const memoryRelativePath = path.join(".tinytutor", "memory.json");
  const fullInstruction = state.pendingQuizDiff
    ? buildQuizInstruction({
        diff: state.pendingQuizDiff,
        weakTopics: memory.weakTopics,
        memoryRelativePath,
      })
    : buildFallbackReminder(memoryRelativePath);

  // Claude Code always shows permissionDecisionReason to the user verbatim
  // as a visible "Error: ..." line — confirmed in testing, true for both the
  // exit-2/stderr path and this JSON path. So the reason stays short; the
  // actual rich quiz content (diff, questions, instructions) goes in
  // additionalContext instead, which the docs describe as "for Claude" —
  // i.e. meant to be consumed, not displayed.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "tinytutor: quick understanding check before more edits.",
        additionalContext: fullInstruction,
      },
    }) + "\n"
  );
  process.exit(0);
}

module.exports = { preToolUseHook, isFileModifyingBash };
