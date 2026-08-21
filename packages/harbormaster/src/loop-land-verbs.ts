/**
 * loop-land-verbs.ts — the injected lifecycle-verb mirror seam (W16-04,
 * FR-T5/D-004). The land loop fires the durable verbs (claim, the park's
 * evidence comment, close); the Forge Mirror needs to write each one
 * through to the configured forge — but harbormaster does not import
 * `@dokima/forge` (ARCHITECTURE §4 matrix: that dependency is apps/server's),
 * so the mirror is INJECTED, the same forge-free pattern as
 * `AttemptOutcomeHook` (W14-05) and `LandR0Consult` (W16-03). `accept` is
 * deliberately absent: accept is a human verb fired outside this loop
 * (W15-01: "nothing accepts"), and its mirror belongs to that surface.
 *
 * Every dispatch is ledger-and-swallow (`runAttemptOutcomeHook`): an
 * unreachable forge must never park a ticket — the composed mirror on the
 * apps/server side owns the offline queue (FR-G5, SC-15).
 */
import type { LandLoopOptions } from './loop-land.js';
import { runAttemptOutcomeHook } from './loop-land-outcome.js';

export interface LandVerbEvent {
  readonly kind: 'claim' | 'evidence' | 'close';
  readonly ticketId: string;
  readonly ticketTitle: string;
  /** `evidence`: the park comment body, verbatim. */
  readonly body?: string;
  /** `close`: the landed commits from the session manifest. */
  readonly commits?: readonly string[];
  /** `close`: the minted close receipt's id. */
  readonly receiptId?: string;
}

export interface LandVerbMirror {
  onVerb(event: LandVerbEvent): void | Promise<void>;
}

/** Fire-and-shield: a mirror failure is ledgered (`memory.hook_failed` posture) and never blocks the loop. */
export async function fireVerbMirror(
  options: LandLoopOptions,
  event: LandVerbEvent,
): Promise<void> {
  if (!options.verbMirror) return;
  await runAttemptOutcomeHook(options, () => options.verbMirror?.onVerb(event));
}
