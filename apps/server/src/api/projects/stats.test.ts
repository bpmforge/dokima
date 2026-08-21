import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, openEventLog, createIdentity } from '@dokima/events';
import { afterEach, describe, expect, it } from 'vitest';
import { createSlate, decideSlate } from '../decisions/store.js';
import { computeProjectStats, latestAdvancedPhase, sumSpendToday } from './stats.js';

/**
 * W10-73. `pendingDecideCount` was a literal `0` in `EMPTY_STATS` and computed
 * nowhere, so a project with a creation run paused on two founder decisions
 * reported that nothing needed the founder. The Fleet card shows this number
 * as an "N needs you" badge AND `fleet/sort.ts` orders the whole Fleet by it —
 * so the project that most needed attention sank to the bottom of the list
 * instead of rising to the top.
 *
 * `apps/server/src/api/projects/` had no test file at all before this ticket.
 */
describe('computeProjectStats counts what needs a human (W10-73)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  async function project(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1073-'));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, '.dokima'), { recursive: true });
    return dir;
  }

  const founderInput = (title: string) => ({
    kind: 'founder' as const,
    founder: {
      title,
      options: [
        { id: 'a', label: 'Option A', tradeoffs: 'fast' },
        { id: 'b', label: 'Option B', tradeoffs: 'slow' },
      ],
      recommendedId: 'a',
      recommendedReasoning: 'ships sooner',
    },
  });

  it('RED FIXTURE: open founder slates are counted, not reported as zero', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    createSlate(log, founderInput('How does data sync'), { actorId: 'operator' });
    createSlate(log, founderInput('Which platforms in v1'), { actorId: 'operator' });
    log.close();

    const stats = await computeProjectStats(dir);

    expect(stats.pendingDecideCount).toBe(2);
  });

  it('drops back to zero as the founder answers — the badge must not outlive the question', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    const record = createSlate(log, founderInput('How does data sync'), {
      actorId: 'operator',
    });
    log.close();

    expect((await computeProjectStats(dir)).pendingDecideCount).toBe(1);

    const write = openEventLog(path.join(dir, '.dokima', 'state.db'));
    decideSlate(
      write,
      { slateId: record.id, chosen: 'a' },
      { projectPath: dir, actorId: 'operator' },
    );
    write.close();

    expect((await computeProjectStats(dir)).pendingDecideCount).toBe(0);
  });

  it('a project with no decisions table at all still renders — a Fleet card never fails over a count', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    log.close();

    const stats = await computeProjectStats(dir);

    expect(stats.pendingDecideCount).toBe(0);
    expect(stats.board).toEqual({ ready: 0, blocked: 0, done: 0 });
  });

  it('the three fields this ticket did NOT compute are still constants, on purpose', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    createSlate(log, founderInput('How does data sync'), { actorId: 'operator' });
    log.close();

    const stats = await computeProjectStats(dir);

    // Pinned so the next reader knows these are unimplemented rather than
    // merely zero right now — the ticket asked for exactly this distinction.
    expect(stats.berthsRunning).toBe(0);
    expect(stats.heartbeatAgeMs).toBeNull();
    expect(stats.spendTodayUsd).toBe(0);
  });

  describe("the Fleet's spend column (W13-24)", () => {
    const spendDirs: string[] = [];

    afterEach(async () => {
      await Promise.all(
        spendDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
      );
    });

    /** A REAL log, not a fake: this is the `listEvents` path production uses. */
    async function logWith(
      entries: Array<{ createdAt: string; payload: unknown; eventType?: string }>,
    ) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-spend-stats-'));
      spendDirs.push(dir);
      const log = openEventLog(path.join(dir, 'state.db'));
      createIdentity(log, { id: 'agent', name: 'Agent', kind: 'machine' });
      for (const e of entries) {
        appendEvent(
          log,
          {
            eventType: e.eventType ?? 'spend.recorded',
            actorId: 'agent',
            payload: e.payload,
          },
          { now: () => e.createdAt },
        );
      }
      return log;
    }

    const NOON = () => new Date('2026-08-19T15:00:00.000Z');

    it(
      "RED FIXTURE: sums today's spend.recorded events instead of reporting a " +
        'constant. It was a hardcoded 0 the Fleet rendered as though measured — ' +
        'the same defect W10-73 found in pendingDecideCount, on the field beside it',
      async () => {
        const log = await logWith([
          { createdAt: '2026-08-19T09:00:00.000Z', payload: { costUsd: 0.25 } },
          { createdAt: '2026-08-19T14:00:00.000Z', payload: { costUsd: 0.5 } },
        ]);
        try {
          expect(sumSpendToday(log, NOON)).toBeCloseTo(0.75);
        } finally {
          log.close();
        }
      },
    );

    it('ignores yesterday — the column answers "today", not a rolling window', async () => {
      const log = await logWith([
        { createdAt: '2026-08-18T23:00:00.000Z', payload: { costUsd: 9.99 } },
        { createdAt: '2026-08-19T10:00:00.000Z', payload: { costUsd: 1 } },
      ]);
      try {
        expect(sumSpendToday(log, NOON)).toBeCloseTo(1);
      } finally {
        log.close();
      }
    });

    it('a local-only run is $0, and that is CORRECT rather than a missing number', async () => {
      // Tokens non-zero, cost zero: metering happened, a local model is free.
      // Law 9b — local-only is a full product, not one with a broken column.
      const log = await logWith([
        { createdAt: '2026-08-19T10:00:00.000Z', payload: { costUsd: 0, promptTokens: 900 } },
      ]);
      try {
        expect(sumSpendToday(log, NOON)).toBe(0);
      } finally {
        log.close();
      }
    });

    it('ignores other event types and malformed payloads rather than throwing', async () => {
      const log = await logWith([
        { eventType: 'run.created', createdAt: '2026-08-19T10:00:00.000Z', payload: { costUsd: 5 } },
        { createdAt: '2026-08-19T10:00:00.000Z', payload: { costUsd: 'lots' } },
        { createdAt: '2026-08-19T10:00:00.000Z', payload: {} },
      ]);
      try {
        expect(sumSpendToday(log, NOON)).toBe(0);
      } finally {
        log.close();
      }
    });
  });
});

describe('the phase column comes alive (W19-01)', () => {
  it('latestAdvancedPhase reads the last receipt-backed advance; none means null (Not started stays honest)', () => {
    const log = openEventLog(':memory:');
    try {
      createIdentity(log, { id: 'phase-gate-runner', name: 'v', kind: 'machine' });
      expect(latestAdvancedPhase(log)).toBeNull();
      appendEvent(log, {
        eventType: 'phase.advanced',
        actorId: 'phase-gate-runner',
        payload: { from: 0, to: 1, gate_receipt_id: 'r-1' },
      });
      expect(latestAdvancedPhase(log)).toBe(1);
    } finally {
      log.close();
    }
  });
});
