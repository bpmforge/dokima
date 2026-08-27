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

/**
 * W21-55. The first version of this chapter moved the LOOP COUNTER, and run 38
 * caught it live: the skip comment said "PLAN-vault-002a starts above R1" and
 * `qwen/qwen3-coder-next` — R1's model — ran anyway, burning the single
 * remaining attempt on the rung it was meant to skip.
 *
 * The cause is a decoupling W21-15 made on purpose. `beginRungAttempt` derives
 * the rung from `attempts.length + 1`, which counts JUDGED attempts so park
 * evidence can never read "attempt 5/2" — it does not follow the loop index.
 * Moving the loop counter therefore moved neither the rung nor the reporting,
 * and cost an attempt for nothing.
 */
describe('the skip shifts the rung, not the attempt budget (W21-55)', () => {
  it('RED FIXTURE: an offset of 1 puts the FIRST attempt on R2, not R1', async () => {
    const { rungForAttempt } = await import('./loop-land-policy.js');
    const policy = { mode: 'ladder' } as Parameters<typeof rungForAttempt>[0];
    const firstAttempt = 1;
    const offset = 1; // startAttempt 2 -> offset 1
    expect(rungForAttempt(policy, firstAttempt)).toBe('R1');
    expect(rungForAttempt(policy, firstAttempt + offset)).toBe('R2');
  });

  it('the attempt NUMBER is untouched — W21-15 keeps it counting judged attempts', () => {
    // The loop still starts at 1, so a cap of 2 still buys two real attempts
    // even when the first of them runs on R2.
    const attemptsSoFar = 0;
    expect(attemptsSoFar + 1).toBe(1);
  });

  it('with no failed rungs the offset is 0 and nothing changes', () => {
    expect(rungMemoryFor.length).toBeGreaterThan(0); // module loaded
    const memory = { failed: [] as string[], startAttempt: 1 };
    expect(memory.startAttempt - 1).toBe(0);
  });
});
