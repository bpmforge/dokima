import { promises as fs } from 'node:fs';
import { resolvePauseAction } from './autonomy.js';
import { appendAutoDefaultRow } from './autonomy-ledger.js';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { createRun } from './breakpoints-runs.js';
import {
  answerClarification,
  askClarification,
  ClarificationNotFoundError,
  ClarificationNotOpenError,
  dismissClarification,
  getClarification,
  isTicketCheckpointed,
  listOpenClarifications,
} from './breakpoints-clarifications.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

async function setup(): Promise<{ log: EventLog; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-clarifications-test-'));
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'human-1', name: 'Brad', kind: 'human' }, { now: NOW });
  createIdentity(
    log,
    { id: 'coding-agent', name: 'coding-agent', kind: 'machine' },
    { now: NOW },
  );
  createRun(
    log,
    {
      id: 'run-1',
      projectId: 'proj-1',
      mode: 'feature',
      breakpoint: 'never',
      actorId: 'human-1',
    },
    { now: NOW },
  );
  return { log, dir };
}

describe('clarification cards (DATABASE.md §4, FR-N1, UC-03, US-701)', () => {
  let log: EventLog | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    log?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    log = undefined;
    dir = undefined;
  });

  it('raises a question card scoped to one ticket', async () => {
    ({ log, dir } = await setup());
    const card = askClarification(
      log,
      {
        id: 'clar-1',
        runId: 'run-1',
        ticketId: 'W3-99',
        askedBy: 'coding-agent',
        question: 'Which auth provider should the fixture use?',
        context: { file: 'src/auth.ts' },
        options: ['local', 'oidc'],
        defaultAction: 'local',
        checkpointRef: 'pass-3',
      },
      { now: NOW },
    );
    expect(card.status).toBe('open');
    expect(card.ticketId).toBe('W3-99');
    expect(card.context).toEqual({ file: 'src/auth.ts' });
    expect(getClarification(log, 'clar-1')).toEqual(card);
  });

  it('only the named ticket is checkpointed — an unrelated ticket id is not', async () => {
    ({ log, dir } = await setup());
    askClarification(
      log,
      {
        id: 'clar-1',
        runId: 'run-1',
        ticketId: 'W3-99',
        askedBy: 'coding-agent',
        question: 'q',
        defaultAction: 'default',
        checkpointRef: 'pass-1',
      },
      { now: NOW },
    );
    expect(isTicketCheckpointed(log, 'W3-99')).toBe(true);
    expect(isTicketCheckpointed(log, 'W3-01')).toBe(false);
  });

  it('answering resolves the card and echoes checkpointRef for the loop to resume at', async () => {
    ({ log, dir } = await setup());
    askClarification(
      log,
      {
        id: 'clar-1',
        runId: 'run-1',
        ticketId: 'W3-99',
        askedBy: 'coding-agent',
        question: 'q',
        defaultAction: 'default',
        checkpointRef: 'pass-7',
      },
      { now: NOW },
    );
    const answered = answerClarification(
      log,
      { id: 'clar-1', answer: 'oidc', actorId: 'human-1' },
      { now: NOW },
    );
    expect(answered.status).toBe('answered');
    expect(answered.answer).toBe('oidc');
    expect(answered.checkpointRef).toBe('pass-7');
    expect(isTicketCheckpointed(log, 'W3-99')).toBe(false);
  });

  it('dismissal takes the documented default and mints an approvals-ledger (auto-default) row', async () => {
    ({ log, dir } = await setup());
    askClarification(
      log,
      {
        id: 'clar-1',
        runId: 'run-1',
        ticketId: 'W3-99',
        askedBy: 'coding-agent',
        question: 'q',
        defaultAction: 'local',
        checkpointRef: 'pass-2',
      },
      { now: NOW },
    );
    const dismissed = dismissClarification(
      log,
      { id: 'clar-1', actorId: 'human-1', ledgerRowId: 'ledger-1' },
      { now: NOW },
    );
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.answer).toBe('local');

    const ledgerEvents = listEvents(log).filter(
      (e) => e.eventType === 'autonomy.ledger_row_appended',
    );
    expect(ledgerEvents).toHaveLength(1);
    expect(ledgerEvents[0]?.payload).toMatchObject({
      pauseSite: 'clarification',
      decision: 'auto-default',
      defaultTaken: 'local',
    });
  });

  it('refuses answer/dismiss on an already-resolved or unknown card', async () => {
    ({ log, dir } = await setup());
    askClarification(
      log,
      {
        id: 'clar-1',
        runId: 'run-1',
        askedBy: 'coding-agent',
        question: 'q',
        defaultAction: 'd',
        checkpointRef: 'p',
      },
      { now: NOW },
    );
    answerClarification(
      log,
      { id: 'clar-1', answer: 'a', actorId: 'human-1' },
      { now: NOW },
    );
    expect(() =>
      answerClarification(log!, { id: 'clar-1', answer: 'again', actorId: 'human-1' }),
    ).toThrow(ClarificationNotOpenError);
    expect(() =>
      dismissClarification(log!, { id: 'nope', actorId: 'human-1', ledgerRowId: 'l' }),
    ).toThrow(ClarificationNotFoundError);
  });

  it('listOpenClarifications filters by run and status', async () => {
    ({ log, dir } = await setup());
    askClarification(
      log,
      {
        id: 'clar-1',
        runId: 'run-1',
        askedBy: 'coding-agent',
        question: 'q1',
        defaultAction: 'd',
        checkpointRef: 'p1',
      },
      { now: NOW },
    );
    askClarification(
      log,
      {
        id: 'clar-2',
        runId: 'run-1',
        askedBy: 'coding-agent',
        question: 'q2',
        defaultAction: 'd',
        checkpointRef: 'p2',
      },
      { now: NOW },
    );
    answerClarification(
      log,
      { id: 'clar-1', answer: 'a', actorId: 'human-1' },
      { now: NOW },
    );
    expect(listOpenClarifications(log, 'run-1').map((c) => c.id)).toEqual(['clar-2']);
    expect(listOpenClarifications(log).map((c) => c.id)).toEqual(['clar-2']);
  });
});

describe('the autonomy dial at the clarification site (W13-32, D-033)', () => {
  let log: EventLog | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    log?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    log = undefined;
    dir = undefined;
  });
  const card = (
    id: string,
    extra: Partial<Parameters<typeof askClarification>[1]> = {},
  ) => ({
    id,
    runId: 'run-1',
    ticketId: 'W3-99',
    askedBy: 'coding-agent',
    question: 'scrypt or argon2?',
    options: ['scrypt', 'argon2'],
    defaultAction: 'scrypt',
    checkpointRef: 'pass-2',
    ...extra,
  });

  it('RED FIXTURE (AC4): auto takes the documented default at the clarification site and ledgers it — decided by nobody, under the asking identity', async () => {
    ({ log, dir } = await setup());
    const record = askClarification(log, card('clar-a'), {
      now: NOW,
      autonomy: { mode: 'auto' },
    });
    expect(record.status).toBe('dismissed');
    expect(record.answer).toBe('scrypt');
    expect(isTicketCheckpointed(log, 'W3-99')).toBe(false);
    const rows = listEvents(log).filter(
      (e) => e.eventType === 'autonomy.ledger_row_appended',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe('coding-agent');
    expect(rows[0]?.payload).toMatchObject({
      pauseSite: 'clarification',
      mode: 'auto',
      decision: 'auto-default',
      defaultTaken: 'scrypt',
      humanSignature: null,
    });
    expect((rows[0]?.payload as { wouldHaveAsked: string }).wouldHaveAsked).toContain(
      'pass-2',
    );
    expect(
      listEvents(log).some((e) => e.eventType === 'clarification.auto_defaulted'),
    ).toBe(true);
  });

  it('interactive, or no dial injected, opens the card and waits — exactly as before', async () => {
    ({ log, dir } = await setup());
    expect(
      askClarification(log, card('clar-i'), {
        now: NOW,
        autonomy: { mode: 'interactive' },
      }).status,
    ).toBe('open');
    expect(askClarification(log, card('clar-n'), { now: NOW }).status).toBe('open');
    expect(isTicketCheckpointed(log, 'W3-99')).toBe(true);
  });

  it('GUARD: a default that is not one of the offered options asks, even in auto', async () => {
    ({ log, dir } = await setup());
    const r1 = askClarification(log, card('clar-g1', { defaultAction: 'bcrypt' }), {
      now: NOW,
      autonomy: { mode: 'auto' },
    });
    expect(r1.status).toBe('open');
    const r2 = askClarification(log, card('clar-g2', { options: undefined }), {
      now: NOW,
      autonomy: { mode: 'auto' },
    });
    expect(r2.status).toBe('open');
  });

  it('GUARD: the per-run cap — the fourth auto-default in a run asks', async () => {
    ({ log, dir } = await setup());
    const statuses = ['1', '2', '3', '4'].map(
      (n) =>
        askClarification(log!, card(`clar-c${n}`), {
          now: NOW,
          autonomy: { mode: 'auto' },
        }).status,
    );
    expect(statuses).toEqual(['dismissed', 'dismissed', 'dismissed', 'open']);
  });

  it('RED FIXTURE (AC3/AC4, C-5): the same auto project still ASKS at a NEVER-AUTO site, and the ledger refuses an auto-default there', async () => {
    ({ log, dir } = await setup());
    expect(resolvePauseAction('auto', 'main-merge')).toBe('ask_human');
    expect(resolvePauseAction('auto', 'deploy')).toBe('ask_human');
    expect(() =>
      appendAutoDefaultRow(log!, {
        id: 'never',
        runId: 'run-1',
        pauseSite: 'main-merge',
        defaultTaken: 'merge',
        wouldHaveAsked: 'merge?',
        actorId: 'coding-agent',
      }),
    ).toThrow(/NEVER-AUTO/);
  });
});
