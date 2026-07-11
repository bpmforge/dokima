import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@shipwright/events';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
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

/**
 * Conformance suite adapted from the source-system ticket semantics
 * (docs/research/source-system-experts.md §6) — behavior parity per D-008,
 * not code copying. Each test title quotes the bullet it ports.
 */
describe('source-system ticket semantics conformance (docs/research/source-system-experts.md §6)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await temp?.cleanup();
  });

  async function setup(): Promise<void> {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
    createIdentity(log, { id: 'reviewer-1', name: 'Reviewer', kind: 'machine' });
    createTicket(
      log,
      'maker-1',
      {
        id: 'W9-01',
        type: 'task',
        title: 'Sample',
        lane: 'core',
        writeScope: ['packages/example/**'],
      },
      { now: NOW },
    );
  }

  it('"Lifecycle: six verbs only (claim/start/close/accept/release/comment), never hand-edited"', async () => {
    await setup();
    let ticket = claimTicket(
      log,
      { ticketId: 'W9-01', actorId: 'maker-1' },
      { now: NOW },
    );
    ticket = startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    ticket = closeTicket(
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
    ticket = acceptTicket(
      log,
      { ticketId: 'W9-01', actorId: 'reviewer-1' },
      { now: NOW },
    );
    expect(ticket.status).toBe('done');
    expect(ticket.history.map((h) => h.verb)).toEqual([
      'claim',
      'start',
      'close',
      'accept',
    ]);
  });

  it('"WIP=1 per actor"', async () => {
    await setup();
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
    let error: unknown;
    try {
      claimTicket(log, { ticketId: 'W9-02', actorId: 'maker-1' }, { now: NOW });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TicketError);
  });

  it('"close refused unless manifest exists ... verify exits 0, and branch+>=1 commit supplied"', async () => {
    await setup();
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    let error: unknown;
    try {
      closeTicket(log, {
        ticketId: 'W9-01',
        actorId: 'maker-1',
        files: ['a.ts'],
        commits: [],
        verify: { command: 'pnpm test', exitCode: 1 },
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TicketError);
  });

  it(
    '"accept (reviewer != owner) refused unless the manifest embeds the close receipt ' +
      'verbatim — the code-enforced end of self-asserted done"',
    async () => {
      await setup();
      claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
      startTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
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
      let selfAcceptError: unknown;
      try {
        acceptTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' });
      } catch (err) {
        selfAcceptError = err;
      }
      expect(selfAcceptError).toBeInstanceOf(TicketError);

      const ticket = acceptTicket(
        log,
        { ticketId: 'W9-01', actorId: 'reviewer-1' },
        { now: NOW },
      );
      expect(ticket.manifest?.closeReceipt).toEqual(
        expect.objectContaining({ ticketId: 'W9-01', ownerId: 'maker-1' }),
      );
    },
  );

  it('"Reflow: claimable = ready ∧ unowned" — release returns a ticket to ready, unowned', async () => {
    await setup();
    claimTicket(log, { ticketId: 'W9-01', actorId: 'maker-1' }, { now: NOW });
    const ticket = releaseTicket(
      log,
      { ticketId: 'W9-01', actorId: 'maker-1' },
      { now: NOW },
    );
    expect(ticket.status).toBe('ready');
    expect(ticket.ownerId).toBeNull();
  });

  it('comment is available on any status and never advances the lifecycle', async () => {
    await setup();
    const ticket = commentTicket(
      log,
      { ticketId: 'W9-01', actorId: 'reviewer-1', body: 'note' },
      { now: NOW },
    );
    expect(ticket.status).toBe('ready');
    expect(ticket.history.at(-1)).toMatchObject({ verb: 'comment', body: 'note' });
  });
});
