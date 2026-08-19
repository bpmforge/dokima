import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';
import { buildRunStatus, executeBuildRunJob } from './runs-routes.js';

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
    const fleetHome = await tmpDir('dokima-runs-routes-');
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
    const projectDir = await tmpDir(`dokima-runs-project-${name}-`);
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'new',
      name,
    });
    const dbDir = path.join(projectDir, '.dokima');
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

describe('build runs (W12-20)', () => {
  const PORT2 = 4319;
  const TOKEN2 = 'test-token-0123456789abcdef';
  const dirs2: string[] = [];
  let active2: ApiServer | undefined;

  afterEach(async () => {
    await active2?.app.close();
    active2 = undefined;
    for (const d of dirs2.splice(0)) await fs.rm(d, { recursive: true, force: true });
  });

  async function boot2() {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-buildrun-'));
    dirs2.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN2,
      port: PORT2,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active2 = server;
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-buildrun-proj-'));
    dirs2.push(projectDir);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
      name: 'br',
    });
    await fs.mkdir(path.join(projectDir, '.dokima'), { recursive: true });
    return {
      app: server.app,
      id: record.id,
      dir: projectDir,
      h: { host: `127.0.0.1:${PORT2}`, authorization: `Bearer ${TOKEN2}` },
    };
  }

  it(
    'RED FIXTURE: a build run can be STARTED from the API. runs-routes served only ' +
      'GET .../runs and GET /runs/:id/trace — both read-only — so every ' +
      'configuration surface was a GUI and the one action that matters was a ' +
      'terminal command',
    async () => {
      // W12-40 made an unset signing key a 409 at request time, so a test
      // about ACCEPTING a run has to supply the precondition it is not testing.
      const previous = process.env.DOKIMA_SIGNING_KEY;
      process.env.DOKIMA_SIGNING_KEY = 'test-signing-key-w1220';
      try {
        const { app, id, h } = await boot2();
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${id}/build-runs`,
          headers: h,
          payload: { actor_id: 'operator', run_id: 'run-w1220' },
        });
        // 202, not 200: the work happens off the request.
        expect(res.statusCode).toBe(202);
        expect(res.json().run_id).toBe('run-w1220');
        expect(res.json().status).toBe('running');
      } finally {
        if (previous === undefined) delete process.env.DOKIMA_SIGNING_KEY;
        else process.env.DOKIMA_SIGNING_KEY = previous;
      }
    },
  );

  it(
    'RED FIXTURE (W12-40): an unset signing key is refused AT REQUEST TIME, not ' +
      'accepted as a 202 and reported through a poll the caller may never make',
    async () => {
      const previous = process.env.DOKIMA_SIGNING_KEY;
      delete process.env.DOKIMA_SIGNING_KEY;
      try {
        const { app, id, h } = await boot2();
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${id}/build-runs`,
          headers: h,
          payload: { actor_id: 'operator', run_id: 'run-nokey' },
        });
        expect(res.statusCode).toBe(409);
        const body = res.json() as Record<string, unknown>;
        // Named, not generic: the caller can act on this one.
        expect(body.rule).toBe('signing-key-unset');
        expect(String(body.detail)).toMatch(/DOKIMA_SIGNING_KEY/);
        // And it says what to do, since there is no surface to do it from.
        expect(String(body.detail)).toMatch(/restart/i);

        // Nothing was started: a refused request must not leave a run id
        // behind that a poller would find sitting at "running" forever.
        const after = await app.inject({
          method: 'GET',
          url: `/api/v1/projects/${id}/build-runs/run-nokey`,
          headers: h,
        });
        expect(after.statusCode).toBe(404);
      } finally {
        if (previous !== undefined) process.env.DOKIMA_SIGNING_KEY = previous;
      }
    },
  );

  it(
    'the job STILL refuses on its own — this route is not the only caller, and a ' +
      'precondition only one entrance enforces is not a precondition (the CLI ' +
      'path calls executeBuildRun directly)',
    async () => {
      const previous = process.env.DOKIMA_SIGNING_KEY;
      delete process.env.DOKIMA_SIGNING_KEY;
      try {
        const { id, dir } = await boot2();
        await executeBuildRunJob({
          projectPath: dir,
          projectId: id,
          actorId: 'operator',
          runId: 'run-direct-nokey',
          now: () => new Date().toISOString(),
        });
        const outcome = buildRunStatus('run-direct-nokey');
        expect(outcome).toBeDefined();
        expect(outcome).not.toBe('running');
        const done = outcome as unknown as { exitCode: number; stderr: string[] };
        expect(done.exitCode).not.toBe(0);
        expect(done.stderr.join('\n')).toMatch(/DOKIMA_SIGNING_KEY/);
      } finally {
        if (previous !== undefined) process.env.DOKIMA_SIGNING_KEY = previous;
      }
    },
    30_000,
  );

  it('an unknown run id is a 404 rather than a fabricated "running"', async () => {
    const { app, id, h } = await boot2();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/build-runs/never-started`,
      headers: h,
    });
    expect(res.statusCode).toBe(404);
  });
});
