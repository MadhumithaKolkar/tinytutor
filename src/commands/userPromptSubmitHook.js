const path = require("path");
const { readState } = require("../lib/state");
const { readMemory } = require("../lib/memory");
const { buildMidQuizReminder } = require("../lib/promptTemplate");

function readStdin() {
  try {
    const fs = require("fs");
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// UserPromptSubmit fires on every user message, unlike PreToolUse (only on
// tool call attempts). During a quiz, the stretches of pure back-and-forth
// between questions have no tool calls at all, so PreToolUse never fires and
// the format rules never get refreshed — this is what actually reaches
// Claude on those turns, confirmed reliable by direct testing (unlike a Stop
// hook's stdout, which is silently ignored in practice).
function userPromptSubmitHook() {
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

  const memory = readMemory(projectRoot);
  const quizCompleted = memory.milestones.length > (state.memoryCountAtBlock || 0);

  if (quizCompleted) {
    process.exit(0);
    return;
  }

  const memoryRelativePath = path.join(".tinytutor", "memory.json");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildMidQuizReminder(memoryRelativePath),
      },
    }) + "\n"
  );
  process.exit(0);
}

module.exports = { userPromptSubmitHook };
