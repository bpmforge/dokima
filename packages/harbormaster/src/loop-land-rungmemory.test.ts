/**
 * W21-46. Runs 26, 28, 32 and 34 each began PLAN-vault-002 at R1 and each
 * spent ~40 turns there before climbing to the rung that had already been
 * shown to do better. The ledger knew every time.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { createTicket, widenTicketScope } from '@dokima/tickets';
import { rungMemoryFor, rungSkipNotice } from './loop-land-rungmemory.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rungmem-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  createTicket(log, 'operator', {
    id: 'T-1',
    type: 'task',
    title: 'Crypto wrappers',
    lane: 'solo',
    writeScope: ['src/crypto/*.ts'],
  });
  return log;
}

const climb = (log: EventLog, fromRung: string, toRung: string, ticketId = 'T-1') =>
  appendEvent(log, {
    eventType: 'escalation.rung_advanced',
    actorId: 'operator',
    ticketId,
    payload: {
      fromRung,
      toRung,
      receipts: [{ name: 'session', exitCode: 1, gapCount: 1, gaps: ['no manifest'] }],
    },
  });

describe('rungMemoryFor (W21-46)', () => {
  it('RED FIXTURE: a rung that already failed this ticket is not re-run from scratch', () => {
    const log = board();
    climb(log, 'R1', 'R2');
    expect(rungMemoryFor(log, 'T-1')).toEqual({ failed: ['R1'], startAttempt: 2 });
    log.close();
  });

  it('a ticket nobody has climbed for still starts cheapest-first (D-018)', () => {
    const log = board();
    expect(rungMemoryFor(log, 'T-1')).toEqual({ failed: [], startAttempt: 1 });
    log.close();
  });

  it('WIDENING THE SCOPE FORGETS — it is not the ticket that defeated R1 any more', () => {
    const log = board();
    climb(log, 'R1', 'R2');
    widenTicketScope(log, {
      ticketId: 'T-1',
      actorId: 'operator',
      add: ['src/crypto/*.spec.ts'],
      reason: 'it is graded on specs it could not write',
    });
    expect(rungMemoryFor(log, 'T-1')).toEqual({ failed: [], startAttempt: 1 });
    log.close();
  });

  it('REPOINTING DEPENDENCIES forgets too — the live split of PLAN-vault-002', () => {
    const log = board();
    climb(log, 'R1', 'R2');
    appendEvent(log, {
      eventType: 'ticket.dependencies_retargeted',
      actorId: 'operator',
      ticketId: 'T-1',
      payload: { from: [], to: ['T-0'], reason: 'split' },
    });
    expect(rungMemoryFor(log, 'T-1').startAttempt).toBe(1);
    log.close();
  });

  it('repeated climbs on the same rung count once — four runs, one fact', () => {
    const log = board();
    climb(log, 'R1', 'R2');
    climb(log, 'R1', 'R2');
    climb(log, 'R1', 'R2');
    expect(rungMemoryFor(log, 'T-1')).toEqual({ failed: ['R1'], startAttempt: 2 });
    log.close();
  });

  it('two rungs failing stacks — start above both', () => {
    const log = board();
    climb(log, 'R1', 'R2');
    climb(log, 'R2', 'R3');
    expect(rungMemoryFor(log, 'T-1')).toEqual({ failed: ['R1', 'R2'], startAttempt: 3 });
    log.close();
  });

  it('another ticket’s climbs are not this ticket’s', () => {
    const log = board();
    climb(log, 'R1', 'R2', 'T-2');
    expect(rungMemoryFor(log, 'T-1').startAttempt).toBe(1);
    log.close();
  });
});

describe('rungSkipNotice (W21-46)', () => {
  it('says WHY it did not start cheap — silence would look like the ladder misbehaving', () => {
    const notice = rungSkipNotice('T-1', { failed: ['R1'], startAttempt: 2 });
    expect(notice).toContain('R1');
    expect(notice).toContain('already');
    expect(notice).toContain('fresh go');
  });

  it('a cheapest-first start says nothing — that is the normal case', () => {
    expect(rungSkipNotice('T-1', { failed: [], startAttempt: 1 })).toBeNull();
  });
});
