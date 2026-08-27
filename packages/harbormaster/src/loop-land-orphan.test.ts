/**
 * W21-40. This shape cost three runs and was identical each time: a run dies
 * holding a claim, the ticket stays in_progress, and the next run reports
 * "0 landed, 0 parked (stop: idle)" while the board shows it in progress.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { claimTicket, createTicket, startTicket } from '@dokima/tickets';
import {
  heldTicketsNotice,
  orphanedClaimNotice,
  orphanedClaims,
} from './loop-land-orphan.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  createTicket(log, 'operator', {
    id: 'PLAN-vault-002',
    type: 'task',
    title: 'Crypto wrappers',
    lane: 'vault-002',
    writeScope: ['src/crypto/**'],
  });
  return log;
}

describe('orphanedClaims (W21-40)', () => {
  it('RED FIXTURE: the live case — a claim from a run that has ended needs no waiting period', () => {
    const log = board();
    claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' }, { runId: 'run-32' });
    startTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' }, { runId: 'run-32' });
    const orphans = orphanedClaims(log, 'run-33');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.heldByRunId).toBe('run-32');
    log.close();
  });

  it('THIS run’s own claim is not an orphan — that would reap live work', () => {
    const log = board();
    claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' }, { runId: 'run-33' });
    expect(orphanedClaims(log, 'run-33')).toHaveLength(0);
    log.close();
  });

  it('a claim with NO run id is left to the thirty-minute window — a person may hold it', () => {
    const log = board();
    claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' });
    expect(orphanedClaims(log, 'run-33')).toHaveLength(0);
    log.close();
  });

  it('a run with no id of its own reaps nothing — guessing would be worse than waiting', () => {
    const log = board();
    claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' }, { runId: 'run-32' });
    expect(orphanedClaims(log, undefined)).toHaveLength(0);
    log.close();
  });

  it('a ticket nobody holds is not an orphan', () => {
    const log = board();
    expect(orphanedClaims(log, 'run-33')).toHaveLength(0);
    log.close();
  });

  it('the notice names the run that held it and why waiting was pointless', () => {
    const log = board();
    claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' }, { runId: 'run-32' });
    const notice = orphanedClaimNotice(orphanedClaims(log, 'run-33')[0]!, 'run-33');
    expect(notice).toContain('run-32');
    expect(notice).toContain('run-33');
    expect(notice).toContain('nothing to wait for');
    expect(notice).toContain('still on its branch');
    log.close();
  });
});

describe('heldTicketsNotice (W21-40)', () => {
  it('RED FIXTURE: "idle" must not read the same as "blocked" — it did, three times', () => {
    const notice = heldTicketsNotice(['PLAN-vault-002']);
    expect(notice).toContain('PLAN-vault-002');
    expect(notice).toContain('no longer running');
    expect(notice).toContain('not the same as there being nothing to do');
  });

  it('a genuinely empty board says nothing extra', () => {
    expect(heldTicketsNotice([])).toBeNull();
  });

  it('singular and plural both read correctly', () => {
    expect(heldTicketsNotice(['A'])).toContain('1 ticket is');
    expect(heldTicketsNotice(['A', 'B'])).toContain('2 tickets are');
  });
});
