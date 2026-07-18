import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  openEventLogReader,
} from '@shipwright/events';
import { claimTicket, closeTicket, createTicket, startTicket } from '@shipwright/tickets';
import { buildApiServer, type ApiServer } from '../server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4401;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('board routes — GET tickets / POST verbs', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: ApiServer['app']; fleetHome: string }> {
    const fleetHome = await tmpDir('shipwright-board-routes-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  function headers() {
    return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
  }

  async function registerProject(
    app: ApiServer['app'],
    fleetHome: string,
    name: string,
  ): Promise<{ id: string; dbPath: string }> {
    const projectDir = path.join(fleetHome, name);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(),
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = res.json() as { id: string };
    return { id, dbPath: path.join(projectDir, '.shipwright', 'state.db') };
  }

  it('rejects an unauthenticated GET tickets list with 401', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/whatever/tickets',
      headers: { host: `127.0.0.1:${PORT}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET tickets 404s for an unregistered project id', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/does-not-exist/tickets',
      headers: headers(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET tickets returns board rows with claimable/staleBlocked/wave/sortKey', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome, 'proj-list');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Ready ticket',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/tickets`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; next_cursor: null };
    expect(body.next_cursor).toBeNull();
    expect(body.items).toEqual([
      expect.objectContaining({
        id: 'T-1',
        status: 'ready',
        claimable: true,
        staleBlocked: false,
        wave: 0,
        sortKey: 'T-1',
      }),
    ]);
  });

  it('filters by claimable=true', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome, 'proj-filter');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Blocked',
      lane: 'ui',
      writeScope: ['a/**'],
      dependsOn: ['T-missing'],
    });
    createTicket(log, 'agent-1', {
      id: 'T-2',
      type: 'task',
      title: 'Ready',
      lane: 'ui',
      writeScope: ['b/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/tickets?claimable=true`,
      headers: headers(),
    });
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items.map((t) => t.id)).toEqual(['T-2']);
  });

  it('POST verb without an Idempotency-Key is refused with 400', async () => {
    const { app, fleetHome } = await boot();
    const { id } = await registerProject(app, fleetHome, 'proj-idem');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=${id}`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST verb without a project query param is refused with 400', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets/T-1/claim',
      headers: { ...headers(), 'idempotency-key': 'k-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST claim fires as the operator identity and publishes a board WS envelope', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome, 'proj-claim');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Ready',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=${id}`,
      headers: { ...headers(), 'idempotency-key': 'k-claim-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const ticket = res.json() as { id: string; status: string; ownerId: string | null };
    expect(ticket.status).toBe('claimed');
    expect(ticket.ownerId).toBe('operator');
  });

  it('echoes X-Event-Seq on a successful mutation (API_DESIGN §1/§5)', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome, 'proj-seq');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Ready',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=${id}`,
      headers: { ...headers(), 'idempotency-key': 'k-seq-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-event-seq']).toBe('2'); // ticket.created=1, ticket.claimed=2
  });

  it('replays the original response for a repeated Idempotency-Key without re-applying the verb', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome, 'proj-replay');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Ready',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=${id}`,
      headers: { ...headers(), 'idempotency-key': 'k-replay-1' },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=${id}`,
      headers: { ...headers(), 'idempotency-key': 'k-replay-1' },
      payload: {},
    });
    expect(replay.statusCode).toBe(first.statusCode);
    expect(replay.json()).toEqual(first.json());
    expect(replay.headers['x-event-seq']).toBe(first.headers['x-event-seq']);

    // The replay never re-ran claim (WIP_LIMIT / already-claimed would 409
    // on a genuine second claim) — confirm the log has exactly one claim event.
    const verifyLog = openEventLogReader(dbPath);
    const events = listEvents({
      db: verifyLog,
      path: dbPath,
      close: () => verifyLog.close(),
    });
    expect(events.filter((e) => e.eventType === 'ticket.claimed')).toHaveLength(1);
    verifyLog.close();
  });

  it('drag-fired close with no manifest is refused with 409 MANIFEST_INVALID (FR-T4)', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome, 'proj-close-refuse');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-2',
      type: 'task',
      title: 'Operator-owned in progress',
      lane: 'ui',
      writeScope: ['b/**'],
    });
    log.close();
    const idem = (key: string) => ({ ...headers(), 'idempotency-key': key });
    // Claim + start through the board (operator identity) so ownership passes
    // and the empty-body `close` a drag onto "In Review" always fires is the
    // only thing that can refuse — a drag can never supply files/verify/commits.
    await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-2/claim?project=${id}`,
      headers: idem('k-1'),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-2/start?project=${id}`,
      headers: idem('k-2'),
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-2/close?project=${id}`,
      headers: idem('k-close-1'),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    const problem = res.json() as { rule: string; detail: string };
    expect(problem.rule).toBe('MANIFEST_INVALID');
    expect(problem.detail).toContain('manifest requires');
  });

  it('a corrupt fleet.json degrades a verb call to 503 problem+json, never an uncaught 500 (THREAT_MODEL §5.6)', async () => {
    const { app, fleetHome } = await boot();
    await registerProject(app, fleetHome, 'proj-corrupt');
    await fs.writeFile(path.join(fleetHome, 'fleet.json'), '{not valid json', 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=whatever`,
      headers: { ...headers(), 'idempotency-key': 'k-corrupt-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ rule: 'FLEET_REGISTRY_CORRUPT' });
  });
});

describe('D-020 accept-actor: operator != agent-maker by construction', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: ApiServer['app']; fleetHome: string }> {
    const fleetHome = await tmpDir('shipwright-accept-actor-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT + 1,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  function headers() {
    return { host: `127.0.0.1:${PORT + 1}`, authorization: `Bearer ${TOKEN}` };
  }

  async function registerProject(
    app: ApiServer['app'],
    fleetHome: string,
  ): Promise<{ id: string; dbPath: string }> {
    const projectDir = path.join(fleetHome, 'accept-actor-project');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(),
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = res.json() as { id: string };
    return { id, dbPath: path.join(projectDir, '.shipwright', 'state.db') };
  }

  it('accept SUCCEEDS on a ticket owned by an agent/maker (via Harbormaster/CLI, never through this API)', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerProject(app, fleetHome);

    // Models Harbormaster/CLI driving the ticket to in_review under the agent's
    // own identity — the board REST API is never involved for claim/start/close
    // here (API_DESIGN §1: "berth and agent actions never come through this API").
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'W-AGENT',
      type: 'task',
      title: 'Agent-owned ticket',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    claimTicket(log, { ticketId: 'W-AGENT', actorId: 'agent-1' });
    startTicket(log, { ticketId: 'W-AGENT', actorId: 'agent-1' });
    closeTicket(log, {
      ticketId: 'W-AGENT',
      actorId: 'agent-1',
      files: ['a/x.ts'],
      commits: ['abc123'],
      verify: { command: 'pnpm test', exitCode: 0 },
    });
    log.close();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/W-AGENT/accept?project=${id}`,
      headers: { ...headers(), 'idempotency-key': 'k-accept-agent' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const ticket = res.json() as { status: string };
    expect(ticket.status).toBe('done');
  });

  it('accept is REFUSED with SELF_ACCEPT, explained inline, on a ticket owned by the operator', async () => {
    const { app, fleetHome } = await boot();
    const { id } = await registerProject(app, fleetHome);
    const idem = (key: string) => ({ ...headers(), 'idempotency-key': key });

    // The whole lifecycle fires through the board API — every mutation carries
    // the fixed operator identity (API_DESIGN §1 "v1: the operator"), so this
    // models a human doing their own manual work end to end via the board.
    const log = openEventLog(
      path.join(fleetHome, 'accept-actor-project', '.shipwright', 'state.db'),
    );
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'W-OPERATOR',
      type: 'task',
      title: 'Operator-owned ticket',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/W-OPERATOR/claim?project=${id}`,
      headers: idem('k-op-claim'),
      payload: {},
    });
    expect(claimRes.statusCode).toBe(200);

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/W-OPERATOR/start?project=${id}`,
      headers: idem('k-op-start'),
      payload: {},
    });
    expect(startRes.statusCode).toBe(200);

    const closeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/W-OPERATOR/close?project=${id}`,
      headers: idem('k-op-close'),
      payload: {
        files: ['a/x.ts'],
        commits: ['def456'],
        verify: { command: 'pnpm test', exitCode: 0 },
      },
    });
    expect(closeRes.statusCode).toBe(200);
    expect((closeRes.json() as { status: string }).status).toBe('in_review');

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/tickets/W-OPERATOR/accept?project=${id}`,
      headers: idem('k-op-accept'),
      payload: {},
    });

    expect(acceptRes.statusCode).toBe(409);
    const problem = acceptRes.json() as { rule: string; detail: string };
    expect(problem.rule).toBe('SELF_ACCEPT');
    expect(problem.detail).toContain('operator');
  });
});

describe('board WS projection (FR-C4, API_DESIGN §3)', () => {
  let active: ApiServer | undefined;
  const dirs: string[] = [];

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('a successful verb publishes a board:{projectId} envelope over WS', async () => {
    const fleetHome = await tmpDir('shipwright-board-ws-');
    dirs.push(fleetHome);
    const port = PORT + 2;
    const server = await buildApiServer({
      token: TOKEN,
      port,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    await server.app.listen({ host: '127.0.0.1', port });

    const headers = { host: `127.0.0.1:${port}`, authorization: `Bearer ${TOKEN}` };
    const projectDir = path.join(fleetHome, 'ws-project');
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = createRes.json() as { id: string };
    const dbPath = path.join(projectDir, '.shipwright', 'state.db');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Ready',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws?token=${TOKEN}`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = (event) => reject(new Error(event.message ?? 'ws error'));
    });
    socket.send(JSON.stringify({ op: 'subscribe', subscriptions: [`board:${id}`] }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const messagePromise = new Promise((resolve) => {
      socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
    });

    await server.app.inject({
      method: 'POST',
      url: `/api/v1/tickets/T-1/claim?project=${id}`,
      headers: { ...headers, 'idempotency-key': 'k-ws-1' },
      payload: {},
    });

    const envelope = (await messagePromise) as {
      sub: string;
      type: string;
      data: unknown;
    };
    expect(envelope.sub).toBe(`board:${id}`);
    expect(envelope.type).toBe('ticket.claimed');
    expect((envelope.data as { id: string; status: string }).status).toBe('claimed');
    socket.close();
  });
});
