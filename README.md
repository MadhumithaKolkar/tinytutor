# tinytutor

<img src="https://cdn.jsdelivr.net/npm/tinytutor/assets/tinytutor.png" alt="tinytutor logo" width="1000" />

**A comprehension checkpoint for AI-assisted development.**

AI coding assistants make it trivially easy to ship code you never actually understood. tinytutor closes that gap: it integrates directly into a Claude Code session and, at defined milestones in the work, verifies that you can explain what was just built before you're allowed to keep building. Incorrect or uncertain answers are met with a plain-language explanation, not a pass. Over time, tinytutor tracks the concepts you consistently struggle with and brings them back for review.

The result is engineering output you can actually stand behind: in a code review, in production, in an interview.

No background service, no additional API key, no runtime dependencies. It runs entirely inside the Claude Code session you already have open.

## Install

```bash
cd your-project
npx tinytutor init
```

`init` will:

- Require the project to be a git repository (milestone detection is diff-based, so run `git init` first if needed)
- Set a checkpoint at the current `HEAD`
- Register a `Stop` hook and a `PreToolUse` hook in `.claude/settings.json`, without altering any existing settings
- Create `.tinytutor/state.json` (checkpoint and thresholds) and `.tinytutor/memory.json` (review history)

There is nothing else to run. The next time Claude Code completes a substantial unit of work in this project and attempts to write further code, tinytutor will engage first.

## How it works

The architecture went through several iterations during development, because the obvious approach does not actually work. That history is worth understanding, since it explains the design.

**`Stop` fires after every conversational turn, not only when a session ends**, including the entirely normal case where Claude has just asked a question and is waiting on a reply. Blocking `Stop` does not mean "pause and wait for the human": it means Claude Code will never hand control back to the terminal, so it regenerates immediately with no opportunity for a real answer. For that reason, `Stop` here is strictly non-blocking. It only detects milestones and stores the relevant diff.

**A non-blocking `Stop` hook can pass plain text back as context, but in practice Claude never acted on it.** It was silently absorbed and never surfaced in an actual response, so it cannot be the delivery mechanism for the review itself.

**The mechanism that works is `PreToolUse`.** It fires immediately before a specific `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, or `Bash` call, rather than at a turn boundary, so denying it does not strand the session in an unanswerable loop: Claude is simply prevented from making that one change until the check-in is complete. `Bash` is included, filtered by a heuristic described below, because a shell command such as `rm file.py` was found in testing to bypass the gate entirely.

**Claude Code always surfaces the reason for a denied tool call to the user**, regardless of which denial mechanism is used; there is no way to suppress that. tinytutor keeps that visible line short and generic, and delivers the actual review content (the diff, the files touched, the questions to ask) through the `additionalContext` field instead, which Claude reads and acts on without displaying it directly.

**An earlier version instructed Claude to avoid mentioning the check-in to the user, and that backfired.** The phrasing read structurally like a prompt injection, a hidden instruction asking a model to conceal something from the person it is talking to, and Claude's own safety training occasionally flagged and refused it. The fix was to make the instruction explicitly transparent: this is a feature the user installed and expects, not something to hide.

Taken together, the flow is:

1. On `Stop`, tinytutor snapshots the working tree (tracked, modified, and untracked files not covered by `.gitignore`) as an out-of-band git commit. This never touches the real index, branch, or `HEAD`. It then diffs that snapshot against the last recorded checkpoint.
2. If the delta crosses the configured threshold (80 changed lines or 3 changed files by default), that is a milestone. tinytutor stores the diff and marks a review as pending. Nothing is shown to the user yet.
3. The next time Claude attempts to modify a file, `PreToolUse` denies that call and passes Claude the actual review content through `additionalContext`: ask questions one at a time based on the real diff, explain incorrect answers plainly, and record a summary in `.tinytutor/memory.json` (that specific write is exempt from the gate, so the loop can always be closed).
4. Once `memory.json` reflects a completed review, the gate lifts and the original edit proceeds normally, along with the checkpoint advance. If a single review is denied an unreasonable number of times in a row, tinytutor force-closes it rather than deadlocking every subsequent edit.

No separate model call and no independent API key are involved. Everything rides on the Claude Code session already in progress.

## Commands

```bash
tinytutor init [--force]      # set up tinytutor in the current project
tinytutor status              # show checkpoint, pending review, and weak topics
tinytutor stop-hook            # (internal) invoked by Claude Code's Stop hook
tinytutor pre-tool-use-hook    # (internal) invoked by Claude Code's PreToolUse hook
```

## Configuring thresholds

Edit `.tinytutor/state.json`:

```json
{
  "config": {
    "linesThreshold": 80,
    "filesThreshold": 3
  }
}
```

Lower thresholds trigger more frequent, smaller reviews; higher thresholds trigger fewer, larger ones. Question count scales with the size of the diff (3 questions for a small milestone, up to 10 for a large one). Claude is instructed to touch every changed file at least once, and never to invent questions about code that is not actually present in the diff, so a review may legitimately end early once there is nothing further to genuinely ask.

## Known limitations

- **The review surfaces on the next edit attempt, not immediately.** Since `PreToolUse` is the only reliable delivery channel, if a milestone is crossed and Claude is never asked to write further code in that session, the review never actually appears; there is nothing to deny. In an active coding session this is rarely relevant, since the next edit attempt is usually close behind.
- **The Bash gate is a heuristic, not a guarantee.** It matches common file-modifying patterns (`rm`, `mv`, `sed -i`, redirection, destructive git operations) so a pending review does not make the shell unusable, but an unusual enough command could still slip through.
- **Git is required.** Milestone detection is diff-based, so projects without git are not yet supported.
- **`git log --all` will surface tinytutor's checkpoint commits.** They live under `refs/tinytutor/checkpoint`, never touch the branch or index, and are invisible to a normal `git log` or `git status`; `--all` walks every ref, so a `tinytutor checkpoint` commit may appear there. This is cosmetic and harmless.
- **State is per-project.** Checkpoints and review history live in `.tinytutor/`, scoped to the current project rather than shared globally.

## License

MIT
