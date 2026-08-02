/**
 * Breakpoints (BLUEPRINT §3.6, FR-H3): `ticket` pauses after every close,
 * `wave` pauses at dependency-wave boundaries, `never` only stops on an
 * explicit kill/pause file (loop-killswitch.ts's `StopSwitch`, already
 * checked between tickets by `runClaimLoop`/`runLandLoop` — out of this
 * ticket's write_scope to rewire). This module is the barrel for the
 * runs/clarifications book (breakpoints-runs.ts, breakpoints-clarifications.ts)
 * plus the one piece of decision logic that composes with a `StopSwitch`:
 * `shouldPauseAtBreakpoint`.
 *
 * Wave numbers are derived from the ticket-id convention this board already
 * uses everywhere (`plan.json`, ROADMAP.md: `W<n>-<seq>`) rather than a new
 * schema field — `@dokima/tickets`' `Ticket` carries no `phase`/`wave`
 * column to read instead.
 */

import type { BreakpointMode } from './breakpoints-types.js';

export type {
  BreakpointMode,
  ClarificationRecord,
  ClarificationStatus,
  RunMode,
  RunRecord,
  RunStatus,
} from './breakpoints-types.js';

export {
  askClarification,
  answerClarification,
  ClarificationNotFoundError,
  ClarificationNotOpenError,
  dismissClarification,
  getClarification,
  isTicketCheckpointed,
  listOpenClarifications,
} from './breakpoints-clarifications.js';
export type {
  AnswerClarificationInput,
  AskClarificationInput,
  ClarificationVerbOptions,
  DismissClarificationInput,
} from './breakpoints-clarifications.js';

export {
  completeRun,
  createRun,
  getRun,
  InvalidRunTransitionError,
  listRuns,
  markRunResumed,
  pauseRun,
  RunNotFoundError,
  stopRun,
  suspendRun,
} from './breakpoints-runs.js';
export type { CreateRunInput, RunVerbOptions } from './breakpoints-runs.js';

const TICKET_ID_WAVE_PATTERN = /^W(\d+)-/;

/** The wave a ticket id belongs to, per this board's own `W<n>-<seq>` convention; `null` for an id that doesn't follow it. */
export function waveOf(ticketId: string): number | null {
  const match = TICKET_ID_WAVE_PATTERN.exec(ticketId);
  if (!match) return null;
  return Number(match[1]);
}

export interface BreakpointCheckInput {
  readonly breakpoint: BreakpointMode;
  /** Wave of the ticket that was just closed. */
  readonly justClosedWave: number | null;
  /** Waves of tickets still claimable right now (the loop's own next-pick set). */
  readonly remainingClaimableWaves: readonly (number | null)[];
}

/**
 * True when the loop should stop after the ticket it just closed, given its
 * breakpoint mode. `'never'` never stops here (only the kill/pause
 * `StopSwitch` does). `'ticket'` always stops — one ticket per invocation is
 * exactly "pause after every close". `'wave'` stops only once no remaining
 * claimable ticket shares the wave that just finished — i.e. the wave
 * boundary was just crossed.
 */
export function shouldPauseAtBreakpoint(input: BreakpointCheckInput): boolean {
  switch (input.breakpoint) {
    case 'never':
      return false;
    case 'ticket':
      return true;
    case 'wave':
      return !input.remainingClaimableWaves.includes(input.justClosedWave);
  }
}
