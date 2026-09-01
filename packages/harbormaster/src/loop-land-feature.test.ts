/**
 * P6-05: the per-feature landing PARK ledger and grouping policy.
 *
 * The refusal-shaped fixtures here are the WAITING half of the port: a
 * blocked member holds the whole feature (the bootstrap's Challenger
 * finding 5), a member neither parked nor closed holds it, and a landed
 * feature's parks are retired so a restart cannot re-land it. The git-side
 * refusals (drift, base-advanced, code conflict, red verify) live in
 * `loop-land-feature-merge.test.ts`.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import type { Ticket, TicketStatus } from '@dokima/tickets';
import {
  FEATURE_LANDED_EVENT,
  featureOf,
  featuresReadyToLand,
  parkedBranches,
  readBoardFeatures,
  recordBoardFeatures,
  recordParkedBranch,
  type BoardFeature,
} from './loop-land-feature.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function makeLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-feature-db-'));
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  cleanups.push(async () => {
    log.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return log;
}

function ticketRow(id: string, status: TicketStatus): Ticket {
  return {
    id,
    type: 'task',
    title: `Ticket ${id}`,
    lane: 'core',
    ownerId: null,
    status,
    interface: null,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    claimRunId: null,
    closedAt: null,
  };
}

function park(ticketId: string, headSha = `sha-${ticketId}`) {
  return { ticketId, branch: `sw/${ticketId.toLowerCase()}`, headSha };
}

describe('board features on the event log (P6-05)', () => {
  it('reads back what was recorded, and the LAST record wins', async () => {
    const log = await makeLog();
    expect(readBoardFeatures(log)).toEqual([]);
    recordBoardFeatures(log, {
      actorId: 'worker-1',
      features: [{ id: 'F-auth', title: 'Auth', tickets: ['T-1', 'T-2'] }],
    });
    recordBoardFeatures(log, {
      actorId: 'worker-1',
      features: [{ id: 'F-auth', tickets: ['T-1', 'T-2', 'T-3'] }],
    });
    expect(readBoardFeatures(log)).toEqual([
      { id: 'F-auth', tickets: ['T-1', 'T-2', 'T-3'] },
    ]);
  });

  it('drops malformed rows instead of crashing the reader', async () => {
    const log = await makeLog();
    appendEvent(log, {
      eventType: 'board.features_recorded',
      actorId: 'worker-1',
      payload: {
        features: [
          { id: 42, tickets: ['T-1'] },
          { id: 'F-ok', tickets: ['T-2'] },
        ],
      },
    });
    expect(readBoardFeatures(log)).toEqual([{ id: 'F-ok', tickets: ['T-2'] }]);
  });
});

describe('the durable park ledger (P6-05)', () => {
  it('replays the latest park per ticket', async () => {
    const log = await makeLog();
    recordParkedBranch(log, {
      actorId: 'worker-1',
      ticketId: 'T-1',
      branch: 'sw/t-1',
      headSha: 'aaa',
    });
    recordParkedBranch(log, {
      actorId: 'worker-1',
      ticketId: 'T-1',
      branch: 'sw/t-1',
      headSha: 'bbb',
    });
    expect(parkedBranches(log).get('T-1')).toEqual({
      ticketId: 'T-1',
      branch: 'sw/t-1',
      headSha: 'bbb',
    });
  });

  it('a feature.landed event RETIRES its members — a restart cannot re-land them', async () => {
    const log = await makeLog();
    recordParkedBranch(log, {
      actorId: 'worker-1',
      ticketId: 'T-1',
      branch: 'sw/t-1',
      headSha: 'aaa',
    });
    recordParkedBranch(log, {
      actorId: 'worker-1',
      ticketId: 'T-2',
      branch: 'sw/t-2',
      headSha: 'ccc',
    });
    appendEvent(log, {
      eventType: FEATURE_LANDED_EVENT,
      actorId: 'worker-1',
      payload: { feature_id: 'F-auth', tickets: ['T-1'] },
    });
    const live = parkedBranches(log);
    expect(live.has('T-1')).toBe(false);
    expect(live.has('T-2')).toBe(true);
  });
});

describe('featureOf (P6-05)', () => {
  const features: BoardFeature[] = [{ id: 'F-auth', tickets: ['W12-03'] }];
  it('prefers the recorded feature map', () => {
    expect(featureOf('W12-03', features)).toBe('F-auth');
  });
  it("falls back to the id-prefix cohort (the bootstrap's wave())", () => {
    expect(featureOf('W12-07', features)).toBe('cohort:W12');
    expect(featureOf('PLAN-vault-002', [])).toBe('cohort:PLAN');
  });
});

describe('featuresReadyToLand (P6-05)', () => {
  const features: BoardFeature[] = [{ id: 'F-auth', tickets: ['T-1', 'T-2', 'T-3'] }];

  it('a feature whose members are all parked or closed is READY', () => {
    const readiness = featuresReadyToLand({
      tickets: [
        ticketRow('T-1', 'in_review'),
        ticketRow('T-2', 'in_review'),
        ticketRow('T-3', 'done'),
      ],
      parked: new Map([
        ['T-1', park('T-1')],
        ['T-2', park('T-2')],
      ]),
      features,
    });
    expect(readiness.waiting).toEqual([]);
    expect(readiness.ready).toHaveLength(1);
    expect(readiness.ready[0]!.featureId).toBe('F-auth');
    expect(readiness.ready[0]!.members.map((m) => m.ticketId)).toEqual(['T-1', 'T-2']);
  });

  it('a BLOCKED member holds the whole feature — blocked is not closed', () => {
    const readiness = featuresReadyToLand({
      tickets: [
        ticketRow('T-1', 'in_review'),
        ticketRow('T-2', 'blocked'),
        ticketRow('T-3', 'done'),
      ],
      parked: new Map([['T-1', park('T-1')]]),
      features,
    });
    expect(readiness.ready).toEqual([]);
    expect(readiness.waiting).toHaveLength(1);
    expect(readiness.waiting[0]!.open).toEqual(['T-2 (blocked)']);
  });

  it('an in_review member WITHOUT a park record holds the feature (closed per-ticket before the mode flipped)', () => {
    const readiness = featuresReadyToLand({
      tickets: [ticketRow('T-1', 'in_review'), ticketRow('T-2', 'in_review')],
      parked: new Map([['T-1', park('T-1')]]),
      features,
    });
    expect(readiness.ready).toEqual([]);
    expect(readiness.waiting[0]!.open).toEqual(['T-2 (in_review)']);
  });

  it('a feature with zero parks is simply not in flight', () => {
    const readiness = featuresReadyToLand({
      tickets: [ticketRow('T-1', 'ready'), ticketRow('X-9', 'ready')],
      parked: new Map(),
      features,
    });
    expect(readiness.ready).toEqual([]);
    expect(readiness.waiting).toEqual([]);
  });

  it('ungrouped tickets cohort by id prefix', () => {
    const readiness = featuresReadyToLand({
      tickets: [ticketRow('W9-01', 'in_review'), ticketRow('W9-02', 'in_progress')],
      parked: new Map([['W9-01', park('W9-01')]]),
      features: [],
    });
    expect(readiness.waiting).toHaveLength(1);
    expect(readiness.waiting[0]!.featureId).toBe('cohort:W9');
    expect(readiness.waiting[0]!.open).toEqual(['W9-02 (in_progress)']);
  });
});
