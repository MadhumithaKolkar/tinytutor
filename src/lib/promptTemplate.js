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
- Every question MUST be about code that is ALREADY WRITTEN and visible, character for character, in the diff below. This includes any edit that is currently paused because of this check-in: that edit hasn't happened yet, so it is not fair game either. Before asking each question, silently locate the exact line(s) in the diff you're asking about; if you can't point to them, don't ask that question. Never ask about a class, function, or field you are only planning to add.
- At minimum, touch on each changed file listed above at least once before considering yourself done (one question can cover a file) — don't stop after just one file when others changed too and still have real content to ask about. Only ask fewer than ${questionCount} if you've already covered every changed file and truly have nothing further and distinct left to ask.
- If the diff represents a full-fledged system (multiple files or components that interact: services, layers, a client and a server, a schema plus the code that uses it, and so on), weight your questions toward SYSTEM DESIGN: why this architecture and not an alternative, how the pieces communicate, what happens at the boundaries, what would break or need to change if one component were swapped out or scaled up. If the diff is just a small isolated function or script with no real architecture to speak of, ask about the code and its concepts instead. Judge this from the actual diff, not by assumption.
- Keep questions plain-language and conversational, like a friendly senior engineer doing a design review — not an exam.
- Format every response (questions, affirmations, and explanations alike) as short bullet points, not paragraphs. Two or three tight bullets beat one dense block of prose. Reserve full sentences for the question itself if a bullet would make it awkward.
- Before moving to the next question (or to writing the summary file, if that answer was the last one), you must first evaluate the answer you just got, out loud, in the response, every single time, with no exceptions. Silently moving on with zero acknowledgment does not satisfy this instruction, even when the answer was correct. If correct or close enough, one bullet saying so (e.g. "- Right — ...") is enough. If wrong, vague, or "I don't know", match this exact shape, every time, no exceptions:

  - [what the answer got wrong or missed, one bullet]
  - [what's actually true, one or two bullets, plain language, no jargon]
  - Think of it like [a simple real-world comparison, one bullet, mandatory even if the explanation above already feels complete]

  Worked example, if the topic were a queue's FIFO ordering:
  - Not quite — it's not that later items get skipped, it's about order.
  - A queue always returns items in the order they came in: first in, first out.
  - Think of it like a line at a coffee shop: whoever joined the line first gets served first, no cutting in line.

  A paragraph, or a next question with no explanation at all, does not satisfy this instruction. Don't be condescending.
- Do not discuss, plan, or offer to continue with the original edit (or any other code change) until every question has been asked and answered and the memory.json summary below has been written. If you catch yourself describing what you'll build next, stop and ask your next check-in question instead.
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

// Delivered via UserPromptSubmit's additionalContext, which (unlike a Stop
// hook's stdout) IS reliably read and acted on — confirmed by direct testing
// against a real session. PreToolUse only fires when Claude attempts a tool
// call, so between quiz questions (pure back-and-forth, no tool calls) there
// is otherwise no way to refresh the format rules; compliance on questions
// after the first was observed to drift without this. Kept short on purpose:
// this fires on every single user message during an open quiz, so it must
// not repeat the full diff or it would dominate the conversation.
function buildMidQuizReminder(memoryRelativePath) {
  return `[tinytutor check-in still open] You're mid check-in with the user from an earlier milestone. Every response from here on must still follow these rules:
- If their last answer was wrong, vague, or "I don't know": explain what's actually true in short bullet points, plain language, then one more bullet starting with the literal words "Think of it like" and a simple real-world comparison. This is mandatory, not optional, and comes before anything else in your response.
- If their last answer was correct or close enough: say so out loud in one bullet (e.g. "- Right — ..."), every time, before moving on. Silently moving to the next step with no acknowledgment at all does not satisfy this.
- Keep responses in bullet points, not paragraphs.
- Only ask about code that already existed in the original diff, never about an edit that's still blocked or only planned.
- Do not discuss, plan, or offer to continue with any code change until the check-in is fully done and ${memoryRelativePath} has been written.
- Ask your next question now if there's one left; otherwise write the ${memoryRelativePath} summary before doing anything else.`;
}

module.exports = { buildQuizInstruction, buildFallbackReminder, buildMidQuizReminder, questionCountFor };
