/**
 * watchdog.test.ts — the pure breach engine.
 *
 * W22-20 deleted `deadLetterAndBlock` and its fixtures with it: they stood up
 * a real SQLite log to prove a function whose only caller was itself deleted
 * (`runWatchdogSession`, W21-36). A green suite over a dead path is the trap
 * both tickets exist to remove, not evidence worth keeping.
 */
import { describe, expect, it } from 'vitest';
import { checkWatchdogBreach } from './watchdog.js';

describe('checkWatchdogBreach', () => {
  it('reports no breach while under both limits', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 10, heartbeatStallSeconds: 5 },
      { startedAtMs: 0, lastHeartbeatAtMs: 0 },
      1_000,
    );
    expect(breach).toBeNull();
  });

  it('breaches on the wall-clock ceiling even with a fresh heartbeat', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 10, heartbeatStallSeconds: 60 },
      { startedAtMs: 0, lastHeartbeatAtMs: 9_999 },
      10_000,
    );
    expect(breach).toEqual({
      reason: 'max_session_seconds',
      elapsedMs: 10_000,
      sinceLastHeartbeatMs: 1,
    });
  });

  it('breaches on heartbeat stall before the wall-clock ceiling', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 60, heartbeatStallSeconds: 5 },
      { startedAtMs: 0, lastHeartbeatAtMs: 1_000 },
      6_000,
    );
    expect(breach).toEqual({
      reason: 'heartbeat_stall',
      elapsedMs: 6_000,
      sinceLastHeartbeatMs: 5_000,
    });
  });

  it('never reports a stall past the wall-clock ceiling — max_session_seconds wins', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 5, heartbeatStallSeconds: 5 },
      { startedAtMs: 0, lastHeartbeatAtMs: 0 },
      5_000,
    );
    expect(breach?.reason).toBe('max_session_seconds');
  });
});
