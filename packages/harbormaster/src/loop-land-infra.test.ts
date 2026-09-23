/**
 * W21-13. An infra retry that says only "endpoint_failure" leaves an operator
 * unable to tell a timeout from a refused connection from a 500 — and those
 * point at completely different fixes. These fixtures pin that the provider's
 * own words reach the ledger, and that they are redacted on the way.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  createFreeRetryGate,
  infraRetryDelayMs,
  MAX_FREE_INFRA_RETRIES,
} from './loop-land-infra.js';
import type { LandLoopOptions } from './loop-land.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function harness(sleep: (ms: number) => Promise<void> = async () => {}): {
  log: EventLog;
  options: LandLoopOptions;
} {
  const target = mkdtempSync(path.join(os.tmpdir(), 'infra-'));
  dirs.push(target);
  const log = openEventLog(path.join(target, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  return {
    log,
    options: { log, actorId: 'operator', sleep } as unknown as LandLoopOptions,
  };
}

describe('an infra retry says WHY (W21-13)', () => {
  it('RED FIXTURE: the ledgered event carries the provider message, not just the category', async () => {
    const { log, options } = harness();
    const gate = createFreeRetryGate(options, 'T-1', 2);
    const took = await gate.take(
      'endpoint_failure',
      1,
      'provider failure: lm-studio: request timed out after 300000ms',
    );
    expect(took).toBe(true);
    const rows = log.db
      .prepare("select payload from events where event_type = 'session.infra_retry'")
      .all() as { payload: string }[];
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    expect(payload.kind).toBe('endpoint_failure');
    // The half that was missing: an operator can now tell a timeout from a
    // refused connection without guessing.
    expect(String(payload.reason)).toContain('timed out after 300000ms');
    log.close();
  });

  it('a provider error that echoes a secret is redacted before it is ledgered', async () => {
    const { log, options } = harness();
    const gate = createFreeRetryGate(options, 'T-1', 2);
    await gate.take(
      'endpoint_failure',
      1,
      'provider failure: bad key sk-abcdefghijklmnopqrstuvwxyz012345',
    );
    const row = log.db
      .prepare("select payload from events where event_type = 'session.infra_retry'")
      .get() as { payload: string };
    expect(row.payload).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    log.close();
  });

  it('no detail is still a valid retry — the category alone must not crash it', async () => {
    const { log, options } = harness();
    const gate = createFreeRetryGate(options, 'T-1', 2);
    expect(await gate.take('endpoint_failure', 1)).toBe(true);
    const row = log.db
      .prepare("select payload from events where event_type = 'session.infra_retry'")
      .get() as { payload: string };
    expect(JSON.parse(row.payload)).not.toHaveProperty('reason');
    log.close();
  });
});

/**
 * W23-50. LIVE 2026-09-23: LM Studio was reloading a model and Dokima's three
 * free retries ran at 18:02:14.97, 15.12 and 15.25Z — all three inside the
 * one-second reload window, all three 400, and the ticket parked as
 * "attempted nothing". The clock here is the injected sleep, so the fixture
 * measures the spacing the gate imposes rather than a real wall clock.
 */
describe('free infra retries back off (W23-50)', () => {
  const RELOAD =
    'provider failure: lm-studio: HTTP 400 Failed to load model "qwen/qwen3.8-27b". Error: Operation canceled.';

  it('RED FIXTURE: three endpoint failures in a row no longer all run within one second of each other', async () => {
    let clock = 0;
    const startedAt: number[] = [];
    const { log, options } = harness(async (ms) => {
      clock += ms;
    });
    const gate = createFreeRetryGate(options, 'T-1', 2);
    for (let i = 1; i <= 3; i++) {
      expect(await gate.take('endpoint_failure', i, RELOAD)).toBe(true);
      startedAt.push(clock);
    }
    expect(startedAt[2]! - startedAt[0]!).toBeGreaterThan(1000);
    expect(startedAt[0]!).toBeGreaterThanOrEqual(1000);
    // The waits are ledgered beside the reason, so an idle run explains itself.
    const waits = (
      log.db
        .prepare("select payload from events where event_type = 'session.infra_retry'")
        .all() as { payload: string }[]
    ).map((r) => (JSON.parse(r.payload) as { waitMs: number }).waitMs);
    expect(waits).toEqual([15_000, 45_000, 60_000]);
    log.close();
  });

  it('exponential with a cap; a model reload starts longer than a plain endpoint failure', () => {
    expect([1, 2, 3, 4].map((n) => infraRetryDelayMs(n))).toEqual([
      5_000, 15_000, 45_000, 60_000,
    ]);
    expect(infraRetryDelayMs(1, 'provider failure: Model unloaded.')).toBe(15_000);
    expect(infraRetryDelayMs(1, 'provider failure: ECONNREFUSED')).toBe(5_000);
  });

  it('the free-retry count is unchanged: the fourth is refused, and a null kind never waits', async () => {
    const waited: number[] = [];
    const { log, options } = harness(async (ms) => {
      waited.push(ms);
    });
    const gate = createFreeRetryGate(options, 'T-1', 2);
    for (let i = 0; i < MAX_FREE_INFRA_RETRIES; i++) {
      expect(await gate.take('endpoint_failure', i + 1)).toBe(true);
    }
    expect(await gate.take('endpoint_failure', 4)).toBe(false);
    expect(await gate.take(null, 5)).toBe(false);
    expect(waited).toHaveLength(MAX_FREE_INFRA_RETRIES);
    expect(gate.limit()).toBe(2 + MAX_FREE_INFRA_RETRIES);
    log.close();
  });
});
