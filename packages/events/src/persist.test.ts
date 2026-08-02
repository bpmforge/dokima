import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, listEvents } from './append.js';
import { openEventLog } from './db.js';
import { createIdentity } from './identities.js';
import { persistBeforeExecute, sweepOrphans } from './persist.js';
import { rebuildProjection, type Projection } from './projection.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';
import type { EventRecord } from './types.js';

/** Any `.started` event with no matching resolution is "in flight". */
const pendingOperationsProjection: Projection<Set<number>> = {
  name: 'pendingOperations',
  initial: () => new Set<number>(),
  reduce: (state, event) => {
    const next = new Set(state);
    if (event.eventType.endsWith('.started')) {
      next.add(event.seq);
    } else {
      const payload = event.payload as { startedSeq?: number } | null;
      if (payload && typeof payload.startedSeq === 'number') {
        next.delete(payload.startedSeq);
      }
    }
    return next;
  },
};

function pendingCount(events: EventRecord[]): number {
  return rebuildProjection(events, pendingOperationsProjection).size;
}

describe('persistBeforeExecute', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('appends started then completed on success, leaving nothing pending', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });

    const result = persistBeforeExecute(
      { log, operation: 'ticket.claim', actorId: 'human-1', ticketId: 'W0-02' },
      () => 'ok',
    );

    expect(result).toBe('ok');
    const events = listEvents(log);
    expect(events.map((e) => e.eventType)).toEqual([
      'ticket.claim.started',
      'ticket.claim.completed',
    ]);
    expect(pendingCount(events)).toBe(0);
    log.close();
  });

  it('appends started then failed when execute throws, leaving nothing pending, and rethrows', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });

    expect(() =>
      persistBeforeExecute({ log, operation: 'ticket.claim', actorId: 'human-1' }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const events = listEvents(log);
    expect(events.map((e) => e.eventType)).toEqual([
      'ticket.claim.started',
      'ticket.claim.failed',
    ]);
    expect(pendingCount(events)).toBe(0);
    log.close();
  });
});

describe('sweepOrphans (NFR-3 crash recovery)', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('resolves a .started event left behind by a simulated crash', async () => {
    temp = await createTempDbPath();

    // Session 1: persists intent, then the process dies before
    // persistBeforeExecute's own try/catch can append a resolution — a
    // real crash never runs that catch block, so we go straight to
    // appendEvent to model the same gap.
    const crashed = openEventLog(temp.dbPath);
    createIdentity(crashed, { id: 'human-1', name: 'Operator', kind: 'human' });
    createIdentity(crashed, { id: 'dokima-system', name: 'System', kind: 'machine' });
    const started = appendEvent(crashed, {
      eventType: 'ticket.claim.started',
      actorId: 'human-1',
      ticketId: 'W0-02',
      payload: null,
    });
    crashed.close();

    // Session 2: reopen with a systemActorId — orphan sweep runs on open.
    const recovered = openEventLog(temp.dbPath, { systemActorId: 'dokima-system' });
    const events = listEvents(recovered);

    const orphanEvent = events.find((e) => e.eventType === 'ticket.claim.orphaned');
    expect(orphanEvent).toBeDefined();
    expect(orphanEvent?.payload).toMatchObject({
      startedSeq: started.seq,
      reason: 'crash-recovery-sweep',
    });
    expect(orphanEvent?.actorId).toBe('dokima-system');
    expect(pendingCount(events)).toBe(0);
    recovered.close();
  });

  it('sweepOrphans is a no-op when nothing is pending', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    createIdentity(log, { id: 'dokima-system', name: 'System', kind: 'machine' });
    persistBeforeExecute(
      { log, operation: 'ticket.claim', actorId: 'human-1' },
      () => 'ok',
    );

    const before = listEvents(log).length;
    const orphaned = sweepOrphans(log, 'dokima-system');
    expect(orphaned).toHaveLength(0);
    expect(listEvents(log)).toHaveLength(before);
    log.close();
  });
});
