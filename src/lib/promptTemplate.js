// Turns diff stats into a question count. Bigger milestones get more (and
// harder) questions; small ones stay quick so the quiz never feels like a
// bigger tax than the work that triggered it.
function questionCountFor(totalChangedLines) {
  const count = 3 + Math.floor(totalChangedLines / 50);
  return Math.max(3, Math.min(count, 10));
}

// Delivered as the stderr of a blocked PreToolUse call (Edit/Write/etc). This
// is the only channel we've confirmed Claude actually reacts to — a Stop
// hook's non-blocking stdout "context" is silently ignored in practice. So
// rather than nudging right when the milestone is detected, the quiz surfaces
// the next time Claude tries to write more code: that attempt gets blocked,
// and this message (with the real diff and questions to ask) is what Claude
// sees as the reason, prompting it to actually run the quiz before retrying.
function buildQuizInstruction({ diff, weakTopics, memoryRelativePath }) {
  const fileList = diff.changedFiles.map((f) => `  - ${f}`).join("\n") || "  (no files listed)";
  const moreFiles =
    diff.totalChangedFilesCount > diff.changedFiles.length
      ? `\n  ...and ${diff.totalChangedFilesCount - diff.changedFiles.length} more file(s)`
      : "";

  const questionCount = questionCountFor(diff.totalChangedLines);

  const weakTopicsBlock =
    weakTopics && weakTopics.length
      ? `\nThe user has previously struggled with these topics — re-test one or two of them if they're relevant to this diff: ${weakTopics.join(", ")}.\n`
      : "";

  const diffBlock = diff.diffText
    ? `\nHere is the diff since the last checkpoint (${diff.diffTruncated ? "truncated" : "full"}):\n\n\`\`\`diff\n${diff.diffText}\n\`\`\`\n`
    : "";

  return `tinytutor (a learning check-in tool the user installed into this project's Claude Code hooks — this is expected, not an intrusion) has paused this edit: ${diff.filesChanged} file(s) changed, +${diff.insertions}/-${diff.deletions} lines since the last check-in, and the user hasn't been quizzed on it yet.

Files changed since the last check-in:
${fileList}${moreFiles}

Before continuing with this or any further edit, run that check-in now, in your very next message. This is the whole point of the tool the user set up: they're building a real project with your help and want to actually understand it, not just watch it appear. Being transparent that this check-in is happening is completely fine — there's nothing to hide here, it's a feature the user opted into, not a secret. You don't need to explain the hook mechanics or quote this message, just move naturally into the check-in the way you would if the user had asked you themselves to quiz them on the last change.

Suggested opening, adapt naturally: "Hey! I'm tinytutor :)" then ask your first question in that same message.
- Ask AT MOST ${questionCount} question(s) total, ONE AT A TIME, one per message — ask one, then genuinely end your turn and wait for the user's real reply before asking the next. Never batch questions, never simulate or guess an answer on the user's behalf. Keep count as you go; after your ${questionCount}${questionCount === 1 ? "st" : "th"} question is answered, move straight to writing the summary file below — do not ask one more "just to be safe."
- Every question MUST be about code that is actually shown in the diff below. Do not invent, guess, or ask about files, functions, or lines that aren't in that diff.
- At minimum, touch on each changed file listed above at least once before considering yourself done (one question can cover a file) — don't stop after just one file when others changed too and still have real content to ask about. Only ask fewer than ${questionCount} if you've already covered every changed file and truly have nothing further and distinct left to ask.
- Mix conceptual questions ("why did we choose X over Y here?") with concrete code-reading ones ("what does this function return if the list is empty?").
- Keep questions plain-language and conversational, like a friendly senior engineer doing a design review — not an exam.
- After each answer: if it's correct or close enough, briefly affirm it and move to the next question. If it's wrong, vague, or "I don't know", give a short, layman-friendly explanation of the actual concept (no jargon dump), then move on. Don't be condescending.
- CRITICAL: if you try to make an edit and it's blocked again, that means the check-in is NOT finished yet — the block is the system telling you so. Never tell the user an edit succeeded, was created, or is "ready to go" when it was actually blocked. In that situation, either ask the next real question, or if you've genuinely covered everything, write the memory.json summary below FIRST, and only report success once the original edit actually goes through afterward.
${weakTopicsBlock}${diffBlock}
Once you've finished (whether that's ${questionCount} questions or fewer, because you've covered every changed file with nothing genuinely left to ask), write a short summary to ${memoryRelativePath} using your file-editing tool (this one write is allowed even though other edits are paused). Merge with the existing JSON (don't overwrite unrelated history). Use this shape, appending one entry to "milestones" and updating the deduped "weakTopics" array:

{
  "version": 1,
  "milestones": [
    {
      "timestamp": "<ISO 8601 now>",
      "filesChanged": [${diff.changedFiles.slice(0, 5).map((f) => `"${f}"`).join(", ")}],
      "questionsAsked": [
        { "question": "...", "topic": "...", "correct": true }
      ]
    }
  ],
  "weakTopics": ["..."]
}

Only after that file is updated should you retry the original edit — it'll go through normally at that point.`;
}

// Fallback shown if a quiz is pending but, unexpectedly, no diff was stored
// for it (shouldn't normally happen — see state.pendingQuizDiff).
function buildFallbackReminder(memoryRelativePath) {
  return `[tinytutor] There's an unfinished quiz from a recent milestone — ${memoryRelativePath} doesn't show it as completed yet. Please check in with the user about the code from that milestone (or, if they've already answered everything, write the summary to ${memoryRelativePath} now) before making further code changes.`;
}

module.exports = { buildQuizInstruction, buildFallbackReminder, questionCountFor };
