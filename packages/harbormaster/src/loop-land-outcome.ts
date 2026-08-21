import { appendEvent } from '@dokima/events';
import type { LandAttempt, LandLoopOptions, LandParkedReason } from './loop-land.js';

/**
 * W14-05: the learning-loop seam. harbormaster may not import `memory`
 * (ARCHITECTURE §4), so the fact producer is INJECTED — apps/server
 * composes it (cli/memory-hooks.ts), the same construction as
 * `memoryAnchor` (W13-23). A hook failure is ledgered and swallowed: a
 * memory store having a bad day must never park a ticket that landed.
 */
export interface AttemptOutcomeHook {
  onParked(input: {
    readonly ticketId: string;
    readonly reason: LandParkedReason;
    readonly attempts: readonly LandAttempt[];
  }): void | Promise<void>;
  onLanded(input: {
    readonly ticketId: string;
    readonly commits: readonly string[];
    readonly attempts: readonly LandAttempt[];
  }): void | Promise<void>;
}

/** Ledger-and-swallow wrapper for the W14-05 hook: the lesson is worth recording, never worth failing the run over. */
export async function runAttemptOutcomeHook(
  options: LandLoopOptions,
  invoke: () => void | Promise<void> | undefined,
): Promise<void> {
  try {
    await invoke();
  } catch (err) {
    appendEvent(options.log, {
      eventType: 'memory.hook_failed',
      actorId: options.actorId,
      payload: { reason: err instanceof Error ? err.message : String(err) },
    });
  }
}
