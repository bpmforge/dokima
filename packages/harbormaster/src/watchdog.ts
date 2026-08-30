/**
 * Per-session watchdog core (BLUEPRINT §3.6/§7.1, FR-H2, NFR-3): every
 * agent session the Harbormaster dispatches is bounded by two independent
 * clocks — a hard `maxSessionSeconds` wall-clock ceiling, and a
 * `heartbeatStallSeconds` liveness check (no observed activity for that
 * long means the session tree has hung, even if it hasn't hit the
 * wall-clock ceiling yet). `checkWatchdogBreach` is the pure decision —
 * no timers of its own, so it's directly unit-testable with synthetic
 * clocks; `watchdog-process.ts` is the real poller that calls it and does
 * the actual killing.
 *
 * A BREACH IS AN OUTCOME, NOT A VERDICT (W22-20). This module used to carry
 * `deadLetterAndBlock`, which minted a `session.dead_letter` event, commented
 * evidence and STOLE the claim back — deciding the ticket's fate on the spot.
 * Both live paths do it the other way: the external CLI forces a non-zero exit
 * through `onBreach` (`run-build-spawn.ts`) and the built-in agent returns a
 * `SpawnSessionOutput` from `watchdogStop` (`session-limits.ts`), so the
 * breach flows into the ladder's ordinary attempt handling and the LADDER
 * decides whether to retry, park or release. Two answers to one question is
 * one too many, and the surviving answer is the one W21-33's ownership guard
 * was built around. Its only caller was `runWatchdogSession`, itself deleted
 * by W21-36 — dead code propping up dead code, which is why both ratchets
 * reported it as reached the whole time.
 */

export type WatchdogBreachReason = 'max_session_seconds' | 'heartbeat_stall';

export interface WatchdogBreach {
  readonly reason: WatchdogBreachReason;
  readonly elapsedMs: number;
  readonly sinceLastHeartbeatMs: number;
}

export interface WatchdogLimits {
  readonly maxSessionSeconds: number;
  readonly heartbeatStallSeconds: number;
}

export interface WatchdogClockState {
  readonly startedAtMs: number;
  /** Last time activity was observed (e.g. stdout/stderr data). Equals `startedAtMs` before the first heartbeat. */
  readonly lastHeartbeatAtMs: number;
}

/**
 * Pure breach check against two injected timestamps — no timers, no I/O.
 * The wall-clock ceiling is checked first: it is a hard cap regardless of
 * how recently the session heartbeated.
 */
export function checkWatchdogBreach(
  limits: WatchdogLimits,
  state: WatchdogClockState,
  nowMs: number,
): WatchdogBreach | null {
  const elapsedMs = nowMs - state.startedAtMs;
  const sinceLastHeartbeatMs = nowMs - state.lastHeartbeatAtMs;
  if (elapsedMs >= limits.maxSessionSeconds * 1000) {
    return { reason: 'max_session_seconds', elapsedMs, sinceLastHeartbeatMs };
  }
  if (sinceLastHeartbeatMs >= limits.heartbeatStallSeconds * 1000) {
    return { reason: 'heartbeat_stall', elapsedMs, sinceLastHeartbeatMs };
  }
  return null;
}
