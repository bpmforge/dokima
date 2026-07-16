/**
 * Provider-limit-aware attempt runner (BLUEPRINT §3.3/§3.6, FR-G8): wraps a berth's attempt
 * (a session dispatch, a direct provider call — anything that can throw or otherwise signal a
 * provider limit) so a limit response parks the berth (ledgers the pause + mints `limit.pause`),
 * waits until the computed resume time, mints `limit.resume`, and retries automatically — no
 * human input, matching `scripts/conductor.mjs`'s own proven `runSession` retry loop (D-008
 * parity: same backoff base, same attempt cap). A terminal classification rethrows immediately;
 * this module never retries an error waiting can't fix.
 *
 * Not yet wired into `loop-claim.ts`/`loop-land.ts` — out of this ticket's write-scope
 * (`packages/harbormaster/src/limit-pause*`), same "drop-in unit a future ticket composes in"
 * posture as `watchdog-session.ts` documents for its own module.
 */

import type { EventLog } from '@shipwright/events';
import { mintLimitPauseEvent, mintLimitResumeEvent } from './limit-pause-events.js';
import { LimitPauseLedger } from './limit-pause-ledger.js';
import type { LimitBerthKey, LimitClassification } from './limit-pause-types.js';

/** Matches scripts/conductor.mjs's own `runSession` retry cap — enough attempts to survive a multi-hour limit window in 5m-backoff steps, never an infinite loop. */
const DEFAULT_MAX_ATTEMPTS = 12;

export interface RunWithLimitPauseOptions {
  readonly key: LimitBerthKey;
  readonly log: EventLog;
  readonly actorId: string;
  readonly ledger: LimitPauseLedger;
  /** Classifies a caught error (or any thrown value) as a provider limit or a terminal failure. Production callers pass `@shipwright/gateway`'s `classifyProviderError` once a follow-up ticket exports it (see limit-pause-types.ts's module doc). */
  readonly classify: (error: unknown) => LimitClassification;
  /** Injectable wait — real callers get a timer; fixtures inject an instant-resolving fake to simulate an overnight window without actually waiting (TESTING.md §2). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable clock in epoch ms (TESTING.md §2). */
  readonly now?: () => number;
  readonly maxAttempts?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attempt` to completion, parking and auto-resuming through any number of provider-limit
 * pauses (up to `maxAttempts`) before giving up. Every pause both ledgers a record (for backoff
 * bookkeeping) and mints a real `limit.pause`/`limit.resume` event pair on `options.log` —
 * always Record tier, never Decide, so an overnight run needs zero human input to survive a
 * limit window.
 */
export async function runWithLimitPause<T>(
  attempt: () => Promise<T>,
  options: RunWithLimitPauseOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const result = await attempt();
      options.ledger.clear(options.key);
      return result;
    } catch (err) {
      const classification = options.classify(err);
      if (classification.class === 'terminal') {
        throw err;
      }
      const nowMs = now();
      const record = options.ledger.park(options.key, classification, nowMs);
      mintLimitPauseEvent(options.log, options.actorId, record);
      const waitMs = Math.max(0, new Date(record.resumeAt).getTime() - nowMs);
      await sleep(waitMs);
      mintLimitResumeEvent(
        options.log,
        options.actorId,
        record,
        new Date(now()).toISOString(),
      );
    }
  }
  throw new Error(
    `limit retries exhausted for berth ${options.key.berthId} after ${maxAttempts} attempts`,
  );
}

export { LimitPauseLedger, LIMIT_BACKOFF_CAP_MS } from './limit-pause-ledger.js';
export { mintLimitPauseEvent, mintLimitResumeEvent } from './limit-pause-events.js';
export type {
  LimitBerthKey,
  LimitClassification,
  LimitErrorClass,
  LimitPauseRecord,
  LimitResumeSource,
} from './limit-pause-types.js';
export type {
  LimitPauseEventPayload,
  LimitResumeEventPayload,
} from './limit-pause-events.js';
