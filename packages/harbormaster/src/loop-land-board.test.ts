/**
 * W21-72. A park raised BEFORE the first attempt already has a written reason
 * — `parkBeforeAttempting` is handed one and comments it on the ticket — and
 * used to drop it from the outcome it returned. Live on run 55 the summary
 * read "PLAN-vault-002: parked (unknown) after 0 attempt(s)" while the ledger
 * held the full explanation at the same moment. Only the report lost it.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { createTicket, type Ticket } from '@dokima/tickets';
import { parkBeforeAttempting, requireTicket } from './loop-land-board.js';

const dirs: string[] = [];
const logs: EventLog[] = [];

afterEach(async () => {
  for (const log of logs.splice(0)) log.close();
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function fixture(): Promise<{ log: EventLog; ticket: Ticket }> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-park-'));
  dirs.push(dbDir);
  const log = openEventLog(path.join(dbDir, 'state.db'));
  logs.push(log);
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createTicket(log, 'worker-1', {
    id: 'T-1',
    type: 'task',
    title: 'Ticket T-1',
    lane: 'core',
    writeScope: ['packages/example/**'],
    verify: 'true',
  });
  return { log, ticket: requireTicket(log, 'T-1') };
}

const STALE_WORKTREE_REASON =
  'T-1 cannot start: its worktree was created from a different base and its branch already ' +
  'holds commits, so reusing it would run against the wrong tree and recreating it would ' +
  'discard that work. Neither is the product’s call.';

describe('a park before the first attempt keeps its reason (W21-72)', () => {
  it('RED FIXTURE: the outcome carries the written reason, not nothing at all', async () => {
    const { log, ticket } = await fixture();
    const outcome = parkBeforeAttempting(
      { log, actorId: 'worker-1' } as never,
      ticket,
      STALE_WORKTREE_REASON,
      () => {},
    );

    expect(outcome.parked).toBe(true);
    expect(outcome.parkedDetail).toBe(STALE_WORKTREE_REASON);
    // A NAMED reason as well as the prose: the header switch in
    // loop-land-report.ts selects on this, and a park with no member would
    // fall through to the ladder-cap sentence — the W21-44 defect, where a
    // park after one attempt announced that a cap of two had been reached.
    expect(outcome.parkedReason).toBe('cannot_start');
  });

  it('still comments the same reason on the ticket, which was never the broken half', async () => {
    const { log, ticket } = await fixture();
    parkBeforeAttempting({ log, actorId: 'worker-1' } as never, ticket, STALE_WORKTREE_REASON, () => {});

    const comments = listEvents(log).filter((e) => e.eventType === 'ticket.commented');
    expect(comments.length).toBe(1);
    expect(JSON.stringify(comments[0]?.payload)).toContain('cannot start');
  });

  it('releases the ticket, so the next run can retry it', async () => {
    const { log, ticket } = await fixture();
    let released: string | undefined;
    parkBeforeAttempting(
      { log, actorId: 'worker-1' } as never,
      ticket,
      STALE_WORKTREE_REASON,
      (_opts, ticketId) => {
        released = ticketId;
      },
    );
    expect(released).toBe('T-1');
  });
});
