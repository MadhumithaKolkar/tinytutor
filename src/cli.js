#!/usr/bin/env node

const { init } = require("./commands/init");
const { stopHook } = require("./commands/stopHook");
const { preToolUseHook } = require("./commands/preToolUseHook");
const { userPromptSubmitHook } = require("./commands/userPromptSubmitHook");
const { status } = require("./commands/status");
const { quiz } = require("./commands/quiz");
const { uninstall } = require("./commands/uninstall");

const HELP = `tinytutor — quizzes you on the code Claude Code just wrote.

Usage:
  tinytutor init [--force]        Set up tinytutor in the current project
  tinytutor status                Show checkpoint, pending quiz, and weak topics
  tinytutor quiz                  Manually trigger a check-in on current changes
  tinytutor uninstall             Remove tinytutor hooks from .claude/settings.json
  tinytutor stop-hook             (internal) invoked by Claude Code's Stop hook
  tinytutor pre-tool-use-hook     (internal) invoked by Claude Code's PreToolUse hook
  tinytutor user-prompt-submit-hook  (internal) invoked by Claude Code's UserPromptSubmit hook
  tinytutor help                  Show this message
`;

function main(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case "init":
      return init(rest);
    case "status":
      return status();
    case "quiz":
      return quiz();
    case "uninstall":
      return uninstall();
    case "stop-hook":
      return stopHook();
    case "pre-tool-use-hook":
      return preToolUseHook();
    case "user-prompt-submit-hook":
      return userPromptSubmitHook();
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`tinytutor: unknown command "${command}"\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

module.exports = { main };
