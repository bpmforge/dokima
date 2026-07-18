import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog } from '@shipwright/events';
import { createTicket } from '@shipwright/tickets';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4403;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('runs routes — session trace (UX_SPEC §4, API_DESIGN "runs/:id/trace")', () => {
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
    const fleetHome = await tmpDir('shipwright-runs-routes-');
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

  async function registerBareProject(fleetHome: string, name: string) {
    const projectDir = await tmpDir(`shipwright-runs-project-${name}-`);
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'new',
      name,
    });
    const dbDir = path.join(projectDir, '.shipwright');
    await fs.mkdir(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'state.db');
    return { id: record.id, dbPath };
  }

  it('requires the "project" query param on both routes', async () => {
    const { app } = await boot();
    const runsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tickets/T-1/runs',
      headers: headers(),
    });
    expect(runsRes.statusCode).toBe(400);

    const traceRes = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/run-1/trace',
      headers: headers(),
    });
    expect(traceRes.statusCode).toBe(400);
  });

  it('returns an honest-empty list when no run has ever touched the ticket', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'runs-empty');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'No runs yet',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tickets/T-1/runs?project=${id}`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('lists distinct run ids for a ticket and the trace filters by run + ticket', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'runs-populated');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'Worked by a run',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    appendEvent(log, {
      eventType: 'loop.pass',
      actorId: 'agent-1',
      ticketId: 'T-1',
      runId: 'run-42',
      payload: { pass: 1 },
    });
    appendEvent(log, {
      eventType: 'loop.pass',
      actorId: 'agent-1',
      ticketId: 'T-1',
      runId: 'run-42',
      payload: { pass: 2 },
    });
    appendEvent(log, {
      eventType: 'loop.pass',
      actorId: 'agent-1',
      ticketId: 'other-ticket',
      runId: 'run-99',
      payload: { pass: 1 },
    });
    log.close();

    const runsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/tickets/T-1/runs?project=${id}`,
      headers: headers(),
    });
    expect(runsRes.statusCode).toBe(200);
    expect(runsRes.json()).toEqual({ items: ['run-42'] });

    const traceRes = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/run-42/trace?project=${id}&ticket=T-1`,
      headers: headers(),
    });
    expect(traceRes.statusCode).toBe(200);
    const body = traceRes.json() as {
      items: Array<{ ticket_id: string; run_id: string }>;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items.every((e) => e.ticket_id === 'T-1' && e.run_id === 'run-42')).toBe(
      true,
    );
  });

  it('404s for an unregistered project on both routes', async () => {
    const { app } = await boot();
    const runsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tickets/T-1/runs?project=does-not-exist',
      headers: headers(),
    });
    expect(runsRes.statusCode).toBe(404);

    const traceRes = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/run-1/trace?project=does-not-exist',
      headers: headers(),
    });
    expect(traceRes.statusCode).toBe(404);
  });
});
