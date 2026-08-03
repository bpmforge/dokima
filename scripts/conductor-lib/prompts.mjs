// conductor-lib/prompts.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.


export function codingPrompt(t, feedback, boardPath = 'plan.json') {
  return `Read CLAUDE.md, MASTER_PROMPT.md and PLAYBOOK.md in this repo and obey them.
You are working EXACTLY ONE ticket from ${boardPath} and nothing else.

TICKET ${t.id} — ${t.title}
lane: ${t.lane} · write_scope: ${JSON.stringify(t.write_scope)}
acceptance:
${t.acceptance.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}
${feedback ? `\nA PREVIOUS ATTEMPT FAILED ITS GATES. You may be resuming partial work — inspect the current tree first. Gate failures to fix:\n${feedback.map((g) => `- ${g}`).join('\n')}\n` : ''}
Rules of engagement:
- You are already on the correct git branch in an isolated worktree. Never switch branches, never touch main, never push.
- Set the ticket in_progress in ${boardPath} first (commit), implement with tests per PLAYBOOK, stage explicit paths only, commit in small steps.
- Run the full gate yourself before closing (the project's lint/typecheck/test).
- When everything passes: set the ticket done in ${boardPath} + append the docs/STATUS.md line (same commit), then stop.
- If genuinely blocked after one honest attempt: set status blocked with a notes entry explaining exactly what is missing, then stop.
- An external conductor independently verifies your work; nothing you print is trusted, only repo state.`;
}

