import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import {
  LimitPauseLedger,
  LIMIT_BACKOFF_CAP_MS,
  runWithLimitPause,
} from './limit-pause.js';
import type { LimitBerthKey, LimitClassification } from './limit-pause-types.js';

interface Fixture {
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-limit-pause-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  return {
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

async function fixture(): Promise<Fixture> {
  const f = await setupFixture();
  fixtures.push(f);
  return f;
}

const KEY: LimitBerthKey = {
  projectId: 'proj-1',
  runId: 'run-1',
  ticketId: 'W3-07',
  berthId: 'berth-1',
  providerId: 'anthropic',
};

/** Same regex `packages/gateway/src/limits/classify.ts` runs — this test fixture stands in for the real `classifyProviderError` (harbormaster can't import gateway's limits module yet; see limit-pause-types.ts's module doc), operating on plain `Error` messages the way a session's captured provider output would. */
const RESET_RE = /resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([ap]m)/i;
function fixtureClassify(nowMs: () => number) {
  return (error: unknown): LimitClassification => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'terminal') return { class: 'terminal' };
    const match = message.match(RESET_RE);
    if (!match) return { class: 'limit' };
    let hour = Number(match[1]!) % 12;
    if (match[3]!.toLowerCase() === 'pm') hour += 12;
    const now = nowMs();
    const reset = new Date(now);
    reset.setHours(hour, Number(match[2]!), 0, 0);
    if (reset.getTime() <= now) reset.setDate(reset.getDate() + 1);
    return { class: 'limit', resumeAt: reset.toISOString() };
  };
}

/** Fake sleeper: never actually waits, but advances the injected clock by the requested duration — lets a test simulate an overnight (hours-long) pause in milliseconds of real wall-clock time. */
function createFakeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe('FR-G8: runWithLimitPause parks on a provider limit and auto-resumes with zero human input', () => {
  it('a fixture provider error with "resets 10:10pm" parks, the limit.pause event carries the computed resume time, then the retried attempt succeeds — no Decide notification anywhere', async () => {
    const { log } = await fixture();
    const startMs = new Date('2026-07-12T12:00:00.000Z').getTime();
    const clock = createFakeClock(startMs);
    const ledger = new LimitPauseLedger();

    let calls = 0;
    const result = await runWithLimitPause(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('usage limit reached, resets 10:10pm');
        return 'ticket-complete';
      },
      {
        key: KEY,
        log,
        actorId: 'worker-1',
        ledger,
        classify: fixtureClassify(clock.now),
        sleep: clock.sleep,
        now: clock.now,
      },
    );

    expect(result).toBe('ticket-complete');
    expect(calls).toBe(2);

    const events = listEvents(log);
    expect(events.map((e) => e.eventType)).toEqual(['limit.pause', 'limit.resume']);

    const pausePayload = events[0]!.payload as Record<string, unknown>;
    expect(pausePayload.tier).toBe('record');
    expect(pausePayload.resumeSource).toBe('stated');
    const expectedResume = new Date(startMs);
    expectedResume.setHours(22, 10, 0, 0);
    expect(pausePayload.resumeAt).toBe(expectedResume.toISOString());

    const resumePayload = events[1]!.payload as Record<string, unknown>;
    expect(resumePayload.tier).toBe('record');

    // Never a Decide-tier notification anywhere in the log.
    for (const e of events) {
      expect((e.payload as Record<string, unknown>).tier).not.toBe('decide');
    }

    // Ledger cleared after the successful retry — a fresh pause would start backoff over.
    expect(ledger.attemptCount(KEY)).toBe(0);
  });

  it('an overnight run survives a simulated 8-hour limit window with zero human input', async () => {
    const { log } = await fixture();
    const startMs = new Date('2026-07-12T23:00:00.000Z').getTime();
    const clock = createFakeClock(startMs);
    const ledger = new LimitPauseLedger();

    let calls = 0;
    const result = await runWithLimitPause(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('session limit, resets at 7:00am');
        return 'done';
      },
      {
        key: KEY,
        log,
        actorId: 'worker-1',
        ledger,
        classify: fixtureClassify(clock.now),
        sleep: clock.sleep,
        now: clock.now,
      },
    );

    expect(result).toBe('done');
    expect(calls).toBe(2);
    const events = listEvents(log);
    expect(events.map((e) => e.eventType)).toEqual(['limit.pause', 'limit.resume']);
    const pausePayload = events[0]!.payload as { resumeAt: string; pausedAt: string };
    const waitedMs =
      new Date(pausePayload.resumeAt).getTime() -
      new Date(pausePayload.pausedAt).getTime();
    expect(waitedMs).toBeGreaterThan(6 * 60 * 60_000); // it really did span hours, not a short retry
  });

  it('rethrows a terminal error immediately without parking or minting any event', async () => {
    const { log } = await fixture();
    const clock = createFakeClock(Date.now());
    const ledger = new LimitPauseLedger();

    await expect(
      runWithLimitPause(
        async () => {
          throw new Error('terminal');
        },
        {
          key: KEY,
          log,
          actorId: 'worker-1',
          ledger,
          classify: fixtureClassify(clock.now),
          sleep: clock.sleep,
          now: clock.now,
        },
      ),
    ).rejects.toThrow('terminal');

    expect(listEvents(log)).toHaveLength(0);
    expect(ledger.attemptCount(KEY)).toBe(0);
  });

  it('exponential backoff (no stated reset time) doubles each consecutive pause, capped at 60m', async () => {
    const { log } = await fixture();
    const clock = createFakeClock(Date.now());
    const ledger = new LimitPauseLedger();

    let calls = 0;
    await runWithLimitPause(
      async () => {
        calls += 1;
        if (calls <= 6) throw new Error('rate limit exceeded');
        return 'ok';
      },
      {
        key: KEY,
        log,
        actorId: 'worker-1',
        ledger,
        classify: fixtureClassify(clock.now),
        sleep: clock.sleep,
        now: clock.now,
        maxAttempts: 10,
      },
    );

    const pauses = listEvents(log).filter((e) => e.eventType === 'limit.pause');
    expect(pauses).toHaveLength(6);
    const waits = pauses.map((e) => {
      const p = e.payload as { pausedAt: string; resumeAt: string };
      return new Date(p.resumeAt).getTime() - new Date(p.pausedAt).getTime();
    });
    expect(waits).toEqual([5, 10, 20, 40, 60, 60].map((m) => m * 60_000));
    expect(Math.max(...waits)).toBeLessThanOrEqual(LIMIT_BACKOFF_CAP_MS);
  });

  it('throws once maxAttempts is exhausted against a persistent limit', async () => {
    const { log } = await fixture();
    const clock = createFakeClock(Date.now());
    const ledger = new LimitPauseLedger();

    await expect(
      runWithLimitPause(
        async () => {
          throw new Error('rate limit exceeded');
        },
        {
          key: KEY,
          log,
          actorId: 'worker-1',
          ledger,
          classify: fixtureClassify(clock.now),
          sleep: clock.sleep,
          now: clock.now,
          maxAttempts: 3,
        },
      ),
    ).rejects.toThrow('limit retries exhausted');

    expect(listEvents(log).filter((e) => e.eventType === 'limit.pause')).toHaveLength(3);
  });
});
