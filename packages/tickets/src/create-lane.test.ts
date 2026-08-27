/**
 * W21-48. A founder may add a ticket to an existing board, and the lane
 * invariant is what makes that safe: cross-lane write-scope overlap is a
 * schema bug (CLAUDE.md law 1) and the reason N berths are provably
 * collision-free. The pipeline's decomposition is checked elsewhere; a ticket
 * a PERSON types has no such pass in front of it.
 *
 * The live case this comes from: PLAN-vault-002 needed tsconfig.json and
 * package.json, `dokima widen-scope` refused with cross-lane-overlap against
 * PLAN-vault-001 — correctly — and the right answer was a new ticket in
 * PLAN-vault-001's lane, which nothing could create.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { createTicket, createTicketValidatingLanes } from './create.js';
import { LaneScopeError } from './lanes.js';
import { listTickets } from './query.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'add-ticket-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'local-operator', name: 'Founder', kind: 'human' });
  createTicket(log, 'local-operator', {
    id: 'PLAN-vault-001',
    type: 'task',
    title: 'Initialize repository',
    lane: 'vault-001',
    writeScope: ['package.json', 'tsconfig.json', 'src/index.ts'],
  });
  createTicket(log, 'local-operator', {
    id: 'PLAN-vault-002',
    type: 'task',
    title: 'Crypto wrappers',
    lane: 'vault-002',
    writeScope: ['src/crypto/*.ts'],
  });
  return log;
}

describe('adding a ticket to an existing board (W21-48)', () => {
  it('RED FIXTURE: the live answer — a test-infrastructure ticket in the lane that OWNS the manifests', () => {
    const log = board();
    const added = createTicketValidatingLanes(log, 'local-operator', {
      id: 'PLAN-vault-001a',
      type: 'task',
      title: 'Test infrastructure so node --test can run TypeScript specs',
      lane: 'vault-001',
      writeScope: ['package.json', 'tsconfig.json'],
    });
    expect(added.lane).toBe('vault-001');
    expect(listTickets(log)).toHaveLength(3);
    log.close();
  });

  it('the SAME ticket in the other lane is refused — the rule that refused the widen', () => {
    const log = board();
    expect(() =>
      createTicketValidatingLanes(log, 'local-operator', {
        id: 'PLAN-vault-002a',
        type: 'task',
        title: 'Test infrastructure',
        lane: 'vault-002',
        writeScope: ['package.json', 'tsconfig.json'],
      }),
    ).toThrow(LaneScopeError);
    log.close();
  });

  it('the refusal names both tickets, so a person can see WHICH lane already owns it', () => {
    const log = board();
    let caught: LaneScopeError | undefined;
    try {
      createTicketValidatingLanes(log, 'local-operator', {
        id: 'PLAN-vault-002a',
        type: 'task',
        title: 'Test infrastructure',
        lane: 'vault-002',
        writeScope: ['tsconfig.json'],
      });
    } catch (err) {
      caught = err as LaneScopeError;
    }
    expect(caught!.message).toContain('PLAN-vault-001');
    expect(caught!.message).toContain('PLAN-vault-002a');
    log.close();
  });

  it('a non-overlapping ticket in a brand-new lane is fine', () => {
    const log = board();
    const added = createTicketValidatingLanes(log, 'local-operator', {
      id: 'PLAN-vault-009',
      type: 'task',
      title: 'End-to-end verification',
      lane: 'vault-009',
      writeScope: ['e2e/**'],
    });
    expect(added.status).toBe('ready');
    log.close();
  });

  it('the DAG takes it: another ticket can depend on the new one', () => {
    const log = board();
    createTicket(log, 'local-operator', {
      id: 'PLAN-vault-001a',
      type: 'task',
      title: 'Test infrastructure',
      lane: 'vault-001',
      writeScope: ['package.json'],
      dependsOn: ['PLAN-vault-001'],
    });
    const added = listTickets(log).find((t) => t.id === 'PLAN-vault-001a');
    expect(added!.dependsOn).toEqual(['PLAN-vault-001']);
    log.close();
  });

  it('creation is attributed to the HUMAN who typed it, never a machine identity', async () => {
    const log = board();
    createTicket(log, 'local-operator', {
      id: 'PLAN-vault-010',
      type: 'task',
      title: 'Docs',
      lane: 'vault-010',
      writeScope: ['docs/**'],
    });
    // The projection starts `history` EMPTY at ticket.created — it records the
    // six lifecycle verbs, not the creation. So the attribution lives on the
    // event, which is the durable answer anyway (C-6).
    const { listEvents } = await import('@dokima/events');
    const created = listEvents(log).find(
      (e) => e.eventType === 'ticket.created' && e.ticketId === 'PLAN-vault-010',
    );
    expect(created!.actorId).toBe('local-operator');
    log.close();
  });
});
