/**
 * agent-session/session-prompt.ts — what the model is told before the ticket.
 *
 * Split out of `gateway-session.ts` under the 400-line CODE_BOOK_PROTOCOL cap
 * (W13-09 took it from 394 to 429), and the seam is real: this is the standing
 * instruction every session gets, while `gateway-session.ts` is the loop that
 * runs one.
 */

/**
 * The two facts a system message is the right home for: how a session ENDS,
 * and that the tools are the only way to touch the repository.
 *
 * There was no system message at all before W13-09 — `messages` was
 * `[{ role: 'user', content: prompt }]`, so every instruction the model ever
 * received was the rendered HANDOFF. The first supervised run failed on
 * exactly that: the agent wrote the function, verified it to exit 0 and
 * committed it, then reported in prose, because prose was what it had been
 * asked for. The loop auto-blocked twice with "no completion manifest
 * returned" and released a ticket whose work was correct.
 *
 * Deliberately SHORT. The handoff carries the ticket-specific contract and the
 * packed context (FR-L5) competes for the same window; anything ticket-shaped
 * belongs there, not here — that is also what the external-agent escape hatch
 * (D-023) receives, so the contract must live in the handoff and this only
 * reinforces it.
 */
export const SESSION_SYSTEM_PROMPT = [
  'You are completing one ticket in a repository you can only reach through the',
  'provided tools. Read and edit files with the tools; do not describe changes',
  'you have not made.',
  '',
  'Work until the ticket is done, then finish by replying with ONLY the JSON',
  'Completion Manifest described at the end of the ticket brief — no prose',
  'around it. That JSON object is the only thing that closes a ticket; a reply',
  'that describes the work instead of returning the manifest ends the session',
  'without closing anything, and the work is discarded.',
].join('\n');
