/**
 * NA-1 enforcement (NEVER-AUTO — interviews always pause for a human, even
 * under `auto` autonomy mode, C-5/FR-N3) plus the adaptive-depth ceiling
 * (AC-1: "Interview adapts question depth to my answers"). Same shape as
 * `../phases/waiver-policy.ts`'s `assertWaiverEligible` — a policy check
 * layered in front of the session engine, throwing before any state change
 * a non-human actor attempted.
 */
import type { AnswerActor } from './types.js';

/** A topic's follow-up loop stops after this many accepted answers even if
 * `deps.nextQuestion` would keep asking — an adaptive ceiling, not an
 * unbounded LLM conversation (mirrors `FR-L7`'s convergence-ceiling
 * discipline for a different loop). */
export const MAX_FOLLOWUP_DEPTH = 4;

export class AutoAnswerRefusedError extends Error {
  constructor(actor: AnswerActor) {
    super(
      `NA-1: interviews are NEVER-AUTO — actor "${actor.id}" (kind "${actor.kind}") cannot answer, ` +
        'skip, or resume an interview topic; only a human actor can (C-5/FR-N3)',
    );
    this.name = 'AutoAnswerRefusedError';
  }
}

/** Throws `AutoAnswerRefusedError` unless `actor.kind === 'human'`. */
export function assertHumanActor(actor: AnswerActor): void {
  if (actor.kind !== 'human') {
    throw new AutoAnswerRefusedError(actor);
  }
}
