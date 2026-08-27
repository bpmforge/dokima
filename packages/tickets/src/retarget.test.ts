/**
 * W21-51. The live case: I added PLAN-vault-001b to fix a toolchain
 * contradiction, it landed, I accepted it — and PLAN-vault-002 still failed,
 * because its dependsOn named only PLAN-vault-001. Its base was composed from
 * the dependency it knew about, so the fix never reached its worktree.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
import { findDependencyCycle, retargetTicketDependencies } from './retarget.js';
import { getTicket, loadTickets } from './query.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'retarget-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'local-operator', name: 'Founder', kind: 'human' });
  const add = (id: string, lane: string, dependsOn: string[] = []) =>
    createTicket(log, 'local-operator', {
      id,
      type: 'task',
      title: id,
      lane,
      writeScope: [`${lane}/**`],
      dependsOn,
    });
  add('PLAN-vault-001', 'vault-001');
  add('PLAN-vault-001b', 'vault-001b', ['PLAN-vault-001']);
  add('PLAN-vault-002', 'vault-002', ['PLAN-vault-001']);
  return log;
}

describe('retargetTicketDependencies (W21-51)', () => {
  it('RED FIXTURE: the live case — vault-002 can be pointed at the ticket that fixes its toolchain', () => {
    const log = board();
    const updated = retargetTicketDependencies(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      dependsOn: ['PLAN-vault-001', 'PLAN-vault-001b'],
      reason: 'its tsconfig fix lives in 001b',
    });
    expect(updated.dependsOn).toEqual(['PLAN-vault-001', 'PLAN-vault-001b']);
    log.close();
  });

  it('the edit is an APPEND — the previous list stays readable in the log (C-6)', () => {
    const log = board();
    retargetTicketDependencies(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      dependsOn: ['PLAN-vault-001b'],
      reason: 'why',
    });
    const event = listEvents(log).find(
      (e) => e.eventType === 'ticket.dependencies_retargeted',
    );
    expect(event!.payload).toMatchObject({
      from: ['PLAN-vault-001'],
      to: ['PLAN-vault-001b'],
      reason: 'why',
    });
    log.close();
  });

  it('an unknown id is refused, named', () => {
    const log = board();
    expect(() =>
      retargetTicketDependencies(log, {
        ticketId: 'PLAN-vault-002',
        actorId: 'local-operator',
        dependsOn: ['PLAN-nope'],
        reason: 'r',
      }),
    ).toThrow(/PLAN-nope/);
    log.close();
  });

  it('a cycle is refused with the path — every ticket on one is unclaimable forever', () => {
    const log = board();
    let caught: TicketError | undefined;
    try {
      // 001b already depends on 001; making 001 depend on 001b closes the loop.
      retargetTicketDependencies(log, {
        ticketId: 'PLAN-vault-001',
        actorId: 'local-operator',
        dependsOn: ['PLAN-vault-001b'],
        reason: 'r',
      });
    } catch (err) {
      caught = err as TicketError;
    }
    expect(caught!.message).toContain('cycle');
    expect(caught!.message).toContain('PLAN-vault-001b');
    log.close();
  });

  it('self-dependency is refused before the walk even starts', () => {
    const log = board();
    expect(() =>
      retargetTicketDependencies(log, {
        ticketId: 'PLAN-vault-002',
        actorId: 'local-operator',
        dependsOn: ['PLAN-vault-002'],
        reason: 'r',
      }),
    ).toThrow(/cannot depend on itself/);
    log.close();
  });

  it('clearing dependencies is legal — a ticket may turn out to need nothing', () => {
    const log = board();
    const updated = retargetTicketDependencies(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      dependsOn: [],
      reason: 'independent after all',
    });
    expect(updated.dependsOn).toEqual([]);
    log.close();
  });

  it('the lifecycle does not move — the DAG changes, the status does not', () => {
    const log = board();
    retargetTicketDependencies(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      dependsOn: ['PLAN-vault-001b'],
      reason: 'r',
    });
    expect(getTicket(log, 'PLAN-vault-002')!.status).toBe('ready');
    log.close();
  });
});

describe('findDependencyCycle (W21-51)', () => {
  it('finds the path back, not merely that one exists', () => {
    const log = board();
    const cycle = findDependencyCycle('PLAN-vault-001', ['PLAN-vault-001b'], loadTickets(log));
    expect(cycle).toEqual(['PLAN-vault-001', 'PLAN-vault-001b', 'PLAN-vault-001']);
    log.close();
  });

  it('an acyclic proposal is null', () => {
    const log = board();
    expect(
      findDependencyCycle('PLAN-vault-002', ['PLAN-vault-001b'], loadTickets(log)),
    ).toBeNull();
    log.close();
  });
});
