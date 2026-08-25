/**
 * Persona-voiced copy for the flows a founder talks through (W20-05).
 *
 * Briefing the team should feel like briefing a person, so the describe flow
 * and the decision slates carry the interviewer's identity. This is a COPY
 * layer over existing flows — no new state machine, no change to what the
 * pipeline does.
 *
 * D-028 still binds: a persona may not claim anything the ledger cannot back.
 * These strings say who is asking and what they are for; they never assert
 * progress, completion, or a state.
 */

/** Ida — the interviewer (docs/design/PERSONAS.md). Mirrored from the server list. */
export const INTERVIEWER = {
  role: 'pm-interviewer',
  displayName: 'Ida',
  avatar: '💡',
} as const;

export function describeHeading(alreadyDescribed: boolean): string {
  return alreadyDescribed
    ? `${INTERVIEWER.displayName} has your description — tell her again to start over`
    : `${INTERVIEWER.displayName} has some questions about what you want built`;
}

export function describeSubhead(): string {
  return `Answer what you can. Anything you leave blank is skipped, not guessed at — one answer is enough for ${INTERVIEWER.displayName} to start, and you can come back.`;
}

/** Who raised a decision slate, said plainly above the choices. */
export function slateAttribution(count: number): string {
  const q = count === 1 ? 'a question' : `${String(count)} questions`;
  return `${INTERVIEWER.displayName} brought you ${q} only you can answer.`;
}
