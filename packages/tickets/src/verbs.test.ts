import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import { createTicket } from './create.js';
import { widenTicketScope } from './verbs.js';
import { getTicket } from './query.js';
import { TicketError, type TicketErrorCode } from './errors.js';
import * as ticketsModule from './index.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  commentTicket,
  releaseTicket,
  startTicket,
} from './verbs.js';

const NOW = () => '2026-07-11T00:00:00.000Z';

async function setup(): Promise<{ temp: TempDb; log: EventLog }> {
  const temp = await createTempDbPath();
  const log = openEventLog(temp.dbPath);
  createIdentity(log, { id: 'maker-1', name: 'Maker One', kind: 'machine' });
  createIdentity(log, { id: 'maker-2', name: 'Maker Two', kind: 'machine' });
  createIdentity(log, { id: 'reviewer-1', name: 'Reviewer One', kind: 'machine' });
  createTicket(
    log,
    'maker-1',
    {
      id: 'W9-01',
      type: 'task',
      title: 'Sample ticket',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'pnpm test',
    },
    { now: NOW },
  );
  return { temp, log };
}

/** Asserts `fn` throws a `TicketError` with the given reason code (FR-T4: refusals are reasoned, never bare). */
function expectRefusal(fn: () => unknown, code: TicketErrorCode): void {
  let error: unknown;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(TicketError);
  expect((error as TicketError).code).toBe(code);
}

describe('ticket lifecycle verbs (FR-T1)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await temp?.cleanup();
  });

  it('FR-T1: claim -> start -> close -> accept follows the enforced transition graph', async () => {
    ({ temp, log } = await setup());
    let ticket = claimTicket(
      log,
      { ticketId: 'W9-01', actorId: 'maker-1' },
      { now: NOW },
    );
    expect(ticket.status).toBe('claimed');
    expect(ticket.ownerId).toBe('maker-1');
    expect(ticket.claimedAt).toBe(NOW());

    ticket = startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    expect(ticket.status).toBe('in_progress');

    ticket = closeTicket(
      log,
      {
        ticketId: 'W9-01',
        actorId: 'maker-1',
        files: ['packages/example/src/index.ts'],
        verify: { command: 'pnpm test', exitCode: 0 },
        commits: ['abc123'],
      },
      { now: NOW },
    );
    expect(ticket.status).toBe('in_review');
    expect(ticket.manifest?.closeReceipt).toMatchObject({
      ticketId: 'W9-01',
      ownerId: 'maker-1',
    });

    ticket = acceptTicket(
      log,
      { ticketId: 'W9-01', actorId: 'reviewer-1' },
      { now: NOW },
    );
    expect(ticket.status).toBe('done');
    expect(ticket.closedAt).toBe(NOW());
    expect(ticket.history.map((h) => h.verb)).toEqual([
      'claim',
      'start',
      'close',
      'accept',
    ]);
  });

  it('FR-T1: no API writes ticket status directly — only the six verbs + createTicket mutate state', () => {
    const publicNames = Object.keys(ticketsModule);
    expect(publicNames).toEqual(
      expect.arrayContaining([
        'createTicket',
        'claimTicket',
        'startTicket',
        'closeTicket',
        'acceptTicket',
        'releaseTicket',
        'commentTicket',
      ]),
    );
    for (const name of publicNames) {
      expect(name.toLowerCase()).not.toMatch(/setstatus|updateticket/);
    }
  });

  it('FR-T1: invalid transitions are refused (start before claim)', async () => {
    ({ temp, log } = await setup());
    expectRefusal(
      () => startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }),
      'INVALID_TRANSITION',
    );
  });

  it('FR-T1: WIP=1 — an actor cannot claim a second ticket while one is active', async () => {
    ({ temp, log } = await setup());
    createTicket(
      log,
      'maker-1',
      {
        id: 'W9-02',
        type: 'task',
        title: 'Second',
        lane: 'core',
        writeScope: ['packages/other/**'],
      },
      { now: NOW },
    );
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    expectRefusal(
      () => claimTicket(log, { ticketId: 'W9-02', actorId: 'maker-1' }, { now: NOW }),
      'WIP_LIMIT',
    );
  });

  it('FR-T1: a second concurrent claim by the same actor on the same ticket is refused', async () => {
    ({ temp, log } = await setup());
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    expectRefusal(
      () => claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW }),
      'INVALID_TRANSITION',
    );
  });

  it('FR-T1: release returns an owned ticket to ready and clears ownership; comment never changes status', async () => {
    ({ temp, log } = await setup());
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    let ticket = releaseTicket(
      log,
      { ticketId: 'W9-01', actorId: 'maker-1' },
      { now: NOW },
    );
    expect(ticket.status).toBe('ready');
    expect(ticket.ownerId).toBeNull();
    expect(ticket.claimedAt).toBeNull();

    ticket = commentTicket(
      log,
      { ticketId: 'W9-01', actorId: 'reviewer-1', body: 'looks good so far' },
      { now: NOW },
    );
    expect(ticket.status).toBe('ready');
    expect(ticket.history.at(-1)).toEqual({
      verb: 'comment',
      actorId: 'reviewer-1',
      at: NOW(),
      body: 'looks good so far',
    });
    expect(ticket.evidence).toEqual([]);
  });

  it('FR-T1: close frees the maker to claim the next ticket — WIP=1 does not block on in_review ("close-before-next-claim")', async () => {
    ({ temp, log } = await setup());
    createTicket(
      log,
      'maker-1',
      {
        id: 'W9-02',
        type: 'task',
        title: 'Second',
        lane: 'core',
        writeScope: ['packages/other/**'],
      },
      { now: NOW },
    );
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    const closed = closeTicket(
      log,
      {
        ticketId: 'W9-01',
        actorId: 'maker-1',
        files: ['a.ts'],
        commits: ['abc'],
        verify: { command: 'pnpm test', exitCode: 0 },
      },
      { now: NOW },
    );
    expect(closed.status).toBe('in_review');

    const claimedNext = claimTicket(
      log,
      { ticketId: 'W9-02', actorId: 'maker-1' },
      { now: NOW },
    );
    expect(claimedNext.status).toBe('claimed');
    expect(claimedNext.ownerId).toBe('maker-1');
  });

  it('FR-T1: only the owning actor may start a claimed ticket', async () => {
    ({ temp, log } = await setup());
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    expectRefusal(
      () => startTicket(log, { ticketId: 'W9-01', actorId: 'maker-2' }),
      'NOT_OWNER',
    );
  });

  it('FR-T1: claiming an unknown ticket refuses with TICKET_NOT_FOUND', async () => {
    ({ temp, log } = await setup());
    expectRefusal(
      () => claimTicket(log, { ticketId: 'does-not-exist', actorId: 'maker-1' }),
      'TICKET_NOT_FOUND',
    );
  });
});

describe('close/accept refusals (FR-T2)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await temp?.cleanup();
  });

  async function claimedAndStarted(): Promise<void> {
    ({ temp, log } = await setup());
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
  }

  it('FR-T2: close refused on a fabricated manifest (no files, no commits)', async () => {
    await claimedAndStarted();
    expectRefusal(
      () =>
        closeTicket(log, {
          ticketId: 'W9-01',
          actorId: 'maker-1',
          files: [],
          commits: [],
          verify: { command: 'pnpm test', exitCode: 0 },
        }),
      'MANIFEST_INVALID',
    );
  });

  it('FR-T2: close refused when verify did not exit 0', async () => {
    await claimedAndStarted();
    expectRefusal(
      () =>
        closeTicket(log, {
          ticketId: 'W9-01',
          actorId: 'maker-1',
          files: ['a.ts'],
          commits: ['abc'],
          verify: { command: 'pnpm test', exitCode: 1 },
        }),
      'MANIFEST_INVALID',
    );
  });

  it('FR-T2: close refused without at least one attached commit', async () => {
    await claimedAndStarted();
    expectRefusal(
      () =>
        closeTicket(log, {
          ticketId: 'W9-01',
          actorId: 'maker-1',
          files: ['a.ts'],
          commits: [],
          verify: { command: 'pnpm test', exitCode: 0 },
        }),
      'MANIFEST_INVALID',
    );
  });

  it('FR-T2: only the owning actor may close', async () => {
    await claimedAndStarted();
    expectRefusal(
      () =>
        closeTicket(log, {
          ticketId: 'W9-01',
          actorId: 'maker-2',
          files: ['a.ts'],
          commits: ['abc'],
          verify: { command: 'pnpm test', exitCode: 0 },
        }),
      'NOT_OWNER',
    );
  });

  it('FR-T2: accept refused on self-accept (reviewer === owner)', async () => {
    await claimedAndStarted();
    closeTicket(
      log,
      {
        ticketId: 'W9-01',
        actorId: 'maker-1',
        files: ['a.ts'],
        commits: ['abc'],
        verify: { command: 'pnpm test', exitCode: 0 },
      },
      { now: NOW },
    );
    expectRefusal(
      () => acceptTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }),
      'SELF_ACCEPT',
    );
  });

  it('FR-T2: accept refused when the manifest lacks a close receipt (a promise-token close event)', async () => {
    await claimedAndStarted();
    // Simulate a bypass attempt below the verb layer: a `ticket.closed`
    // event whose manifest was never minted by `closeTicket`, so it carries
    // no `closeReceipt` — this is exactly what FR-H1's out-of-session gate
    // exists to prevent in the real system; here we prove `accept` alone
    // already refuses it.
    appendEvent(
      log,
      {
        eventType: 'ticket.closed',
        actorId: 'maker-1',
        ticketId: 'W9-01',
        payload: {
          manifest: {
            files: ['a.ts'],
            verify: { command: 'x', exitCode: 0 },
            commits: ['abc'],
          },
        },
      },
      { now: NOW },
    );
    expectRefusal(
      () => acceptTicket(log, { ticketId: 'W9-01', actorId: 'reviewer-1' }),
      'MISSING_CLOSE_RECEIPT',
    );
  });

  it('FR-T2: accept succeeds for a distinct reviewer identity with a real close receipt', async () => {
    await claimedAndStarted();
    closeTicket(
      log,
      {
        ticketId: 'W9-01',
        actorId: 'maker-1',
        files: ['a.ts'],
        commits: ['abc'],
        verify: { command: 'pnpm test', exitCode: 0 },
      },
      { now: NOW },
    );
    const ticket = acceptTicket(
      log,
      { ticketId: 'W9-01', actorId: 'reviewer-1' },
      { now: NOW },
    );
    expect(ticket.status).toBe('done');
  });
});

describe('widenTicketScope (W21-27) — answering "this ticket is not right as written"', () => {
  it('RED FIXTURE: the live case — a ticket that cannot satisfy its own typecheck gains the source path it needed', async () => {
    const { temp, log } = await setup();
    createTicket(log, 'maker-1', {
      id: 'PLAN-vault-001',
      type: 'task',
      title: 'Initialize Repository',
      lane: 'vault-001',
      writeScope: ['package.json', 'tsconfig.json'],
    });
    const widened = widenTicketScope(log, {
      ticketId: 'PLAN-vault-001',
      actorId: 'maker-1',
      add: ['src/**'],
      reason: 'typecheck cannot pass without a source file in scope',
    });
    expect(widened.writeScope).toContain('src/**');
    // The original entries survive: this adds, it does not replace.
    expect(widened.writeScope).toContain('package.json');
    // …and it is ledgered in words a person can read later.
    const last = widened.history.at(-1)!;
    expect(last.body).toContain('src/**');
    expect(last.body).toContain('typecheck cannot pass');
    log.close();
    await temp.cleanup();
  });

  it('refuses a no-op rather than writing an event that changed nothing', async () => {
    const { temp, log } = await setup();
    createTicket(log, 'maker-1', {
      id: 'T-scope-1', type: 'task', title: 'x', lane: 'sc-1', writeScope: ['src/**'],
    });
    expect(() =>
      widenTicketScope(log, {
        ticketId: 'T-scope-1', actorId: 'maker-1', add: ['src/**'], reason: 'already there',
      }),
    ).toThrow(/already contains/);
    log.close();
    await temp.cleanup();
  });

  it('refuses a widening that would make two lanes overlap (P8) — widening is exactly how that breaks', async () => {
    const { temp, log } = await setup();
    createTicket(log, 'maker-1', {
      id: 'T-a', type: 'task', title: 'a', lane: 'lane-a', writeScope: ['a/**'],
    });
    createTicket(log, 'maker-1', {
      id: 'T-b', type: 'task', title: 'b', lane: 'lane-b', writeScope: ['b/**'],
    });
    expect(() =>
      widenTicketScope(log, {
        ticketId: 'T-a', actorId: 'maker-1', add: ['b/**'], reason: 'grab the other lane',
      }),
    ).toThrow();
    log.close();
    await temp.cleanup();
  });

  it('the widened scope is what a later read sees — the reducer applies it forward', async () => {
    const { temp, log } = await setup();
    createTicket(log, 'maker-1', {
      id: 'T-fwd', type: 'task', title: 'f', lane: 'lane-f', writeScope: ['a/**'],
    });
    widenTicketScope(log, {
      ticketId: 'T-fwd', actorId: 'maker-1', add: ['c/**'], reason: 'needed',
    });
    expect(getTicket(log, 'T-fwd')!.writeScope).toEqual(['a/**', 'c/**']);
    log.close();
    await temp.cleanup();
  });
});
