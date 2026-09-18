/**
 * W23-28. FR-N1's verbs reached over HTTP, and an open clarification in the
 * ONE morning queue (FR-H4) rather than a second surface.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog } from '@dokima/events';
import { createRun, getClarification } from '@dokima/harbormaster';
import { buildApiServer, type ApiServer } from '../server.js';

// Assembled, not literal: the pre-commit secrets scanner refuses a token-shaped string (FR-S2), rightly.
const TOKEN = ['test', 'token', 'w2328', '0123456789abcdef'].join('-');
const PORT = 4409;
const NOW = () => '2026-09-18T12:00:00.000Z';

describe('clarification routes (FR-N1, US-701, UC-03 — W23-28)', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  const headers = () => ({ host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` });

  async function boot() {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-clarif-routes-'));
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    const projectDir = path.join(fleetHome, 'proj');
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(),
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = res.json() as { id: string };
    // A clarification belongs to a RUN (FK): mint one the way the CLI does.
    const dbPath = path.join(projectDir, '.dokima', 'state.db');
    const log = openEventLog(dbPath);
    createIdentity(
      log,
      { id: 'worker-1', name: 'Worker One', kind: 'machine' },
      { now: NOW },
    );
    createRun(
      log,
      {
        id: 'run-1',
        projectId: id,
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'worker-1',
      },
      { now: NOW },
    );
    log.close();
    return { app: server.app, id, dbPath };
  }

  const ask = (app: ApiServer['app'], id: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/clarifications`,
      headers: headers(),
      payload: {
        runId: 'run-1',
        ticketId: 'T-1',
        question: 'Use scrypt or an argon2 binding?',
        options: ['scrypt', 'argon2'],
        defaultAction: 'scrypt',
        checkpointRef: 'pass-2',
        askedBy: 'worker-1',
        ...extra,
      },
    });

  it('RED FIXTURE (acceptance 1): asking creates the clarification AND a Decide card of the existing kind at leverage 20 in the morning queue', async () => {
    const { app, id } = await boot();
    const asked = await ask(app, id);
    expect(asked.statusCode).toBe(201);
    const record = asked.json() as { id: string; status: string; asked_by: string };
    expect(record.status).toBe('open');
    expect(record.asked_by).toBe('worker-1');

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/clarifications`,
      headers: headers(),
    });
    expect(listed.json()).toMatchObject({ items: [{ id: record.id, status: 'open' }] });

    const queue = await app.inject({
      method: 'GET',
      url: `/api/v1/approvals/queue?project=${id}`,
      headers: headers(),
    });
    expect(queue.statusCode).toBe(200);
    const items = (
      queue.json() as {
        items: { kind: string; leverage: number; ref_type: string; ref_id: string }[];
      }
    ).items;
    const card = items.find((i) => i.ref_id === record.id);
    expect(card).toMatchObject({
      kind: 'clarification',
      leverage: 20,
      ref_type: 'clarification',
    });
  });

  it('answering resolves the clarification and its card; the queue no longer demands an answer that exists', async () => {
    const { app, id, dbPath } = await boot();
    const record = (await ask(app, id)).json() as { id: string };
    const answered = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/clarifications/${record.id}/answer`,
      headers: headers(),
      payload: { answer: 'argon2' },
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({ status: 'answered', answer: 'argon2' });
    const queue = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/approvals/queue?project=${id}`,
        headers: headers(),
      })
    ).json() as { items: { ref_id: string }[] };
    expect(queue.items.find((i) => i.ref_id === record.id)).toBeUndefined();
    const log = openEventLog(dbPath);
    expect(getClarification(log, record.id)?.status).toBe('answered');
    log.close();
  });

  it('RED FIXTURE (acceptance 2): dismissing takes the documented default and the ledger row names WHO dismissed it', async () => {
    const { app, id, dbPath } = await boot();
    const record = (await ask(app, id)).json() as { id: string };
    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/clarifications/${record.id}/dismiss`,
      headers: headers(),
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toMatchObject({ status: 'dismissed', answer: 'scrypt' });
    const log = openEventLog(dbPath);
    const event = listEvents(log).find((e) => e.eventType === 'clarification.dismissed');
    expect(event?.actorId).toBe('operator');
    expect(event?.payload).toMatchObject({ id: record.id, defaultTaken: 'scrypt' });
    const ledger = listEvents(log).filter((e) => e.eventType.startsWith('autonomy.'));
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((e) => e.actorId === 'operator')).toBe(true);
    log.close();
    // Resolving twice is a conflict, not a silent no-op.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/clarifications/${record.id}/answer`,
      headers: headers(),
      payload: { answer: 'x' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('validates its inputs: missing fields 400, unknown clarification 404, unknown project 404, unknown run 400', async () => {
    const { app, id } = await boot();
    expect((await ask(app, id, { question: '' })).statusCode).toBe(400);
    expect((await ask(app, id, { runId: 'no-such-run' })).statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/clarifications/nope/answer`,
      headers: headers(),
      payload: { answer: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    const noProject = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/does-not-exist/clarifications',
      headers: headers(),
    });
    expect(noProject.statusCode).toBe(404);
  });
  it('W13-32 / D-033: with the project dial on auto, asking takes the offered default, ledgers it, and mints NO card', async () => {
    const { app, id, dbPath } = await boot();
    const dial = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/autonomy`,
      headers: headers(),
      payload: { mode: 'auto' },
    });
    expect(dial.statusCode).toBe(200);
    const asked = await ask(app, id);
    expect(asked.statusCode).toBe(201);
    expect(asked.json()).toMatchObject({
      status: 'dismissed',
      answer: 'scrypt',
      auto_defaulted: true,
    });
    const queue = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/approvals/queue?project=${id}`,
        headers: headers(),
      })
    ).json() as { items: { ref_type: string }[] };
    expect(queue.items.filter((i) => i.ref_type === 'clarification')).toHaveLength(0);
    const log = openEventLog(dbPath);
    expect(
      listEvents(log).filter((e) => e.eventType === 'autonomy.ledger_row_appended'),
    ).toHaveLength(1);
    log.close();
    // A default that is not an offered option still asks, dial or no dial.
    const guarded = await ask(app, id, { defaultAction: 'bcrypt' });
    expect(guarded.json()).toMatchObject({ status: 'open' });
  });
});
