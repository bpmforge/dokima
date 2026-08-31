import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, listEvents, openEventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
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
    'RED FIXTURE: a run started by an actor with no identity still WORKS. Every ' +
      'ledgered step runs under that actor and `appendEvent` is FK-enforced, so ' +
      'an unknown one made the run die with the raw SQLite string "FOREIGN KEY ' +
      'constraint failed" — naming no actor, no field and no remedy. The stop ' +
      'route twelve lines away already ensures the identity first (W22-27)',
    async () => {
      const previous = process.env.DOKIMA_SIGNING_KEY;
      process.env.DOKIMA_SIGNING_KEY = 'test-signing-key-w2227';
      try {
        const { app, id, dir, h } = await boot2();
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${id}/build-runs`,
          headers: h,
          payload: { actor_id: 'a-brand-new-operator', run_id: 'run-w2227' },
        });
        expect(res.statusCode).toBe(202);

        // The identity now exists, which is the whole fix: nothing the run
        // appends can trip the foreign key.
        const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
        try {
          expect(() =>
            appendEvent(log, {
              eventType: 'run.probe',
              actorId: 'a-brand-new-operator',
              payload: {},
            }),
          ).not.toThrow();
        } finally {
          log.close();
        }
      } finally {
        if (previous === undefined) delete process.env.DOKIMA_SIGNING_KEY;
        else process.env.DOKIMA_SIGNING_KEY = previous;
      }
    },
  );

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

  /** Gives a project one receipt, so a replacement key would invalidate something. */
  function plantReceipt(projectDir: string): void {
    const log = openEventLog(path.join(projectDir, '.dokima', 'state.db'));
    try {
      createIdentity(log, { id: 'mac', name: 'mac', kind: 'machine' });
      log.db
        .prepare(
          `INSERT INTO receipts
             (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
              verify_command, verify_exit, signed_by, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('r-1', 'close', 'p', null, null, '[]', 'hash', 'true', 0, 'mac', '{}', '2026-08-19T00:00:00.000Z');
    } finally {
      log.close();
    }
  }

  it(
    'W12-43: an unset key on a project with NO receipts MINTS one and proceeds. ' +
      'W12-40 refused here, correctly for its time — but the refusal told a ' +
      'user to restart the core with an env var, for a secret only randomBytes ' +
      'can sensibly produce',
    async () => {
      const previous = process.env.DOKIMA_SIGNING_KEY;
      delete process.env.DOKIMA_SIGNING_KEY;
      try {
        const { app, id, h } = await boot2();
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${id}/build-runs`,
          headers: h,
          payload: { actor_id: 'operator', run_id: 'run-mint' },
        });
        expect(res.statusCode).toBe(202);
      } finally {
        if (previous !== undefined) process.env.DOKIMA_SIGNING_KEY = previous;
      }
    },
    30_000,
  );

  it(
    'RED FIXTURE (W12-43): but a project that ALREADY HAS receipts is refused. ' +
      'A replacement key does not fail loudly — it makes every existing receipt ' +
      'fail its MAC, so the project would quietly report itself unverifiable ' +
      'and every completed phase would look stale',
    async () => {
      const previous = process.env.DOKIMA_SIGNING_KEY;
      const previousHome = process.env.DOKIMA_HOME;
      delete process.env.DOKIMA_SIGNING_KEY;
      // A FRESH home, so the vault file does not exist at all: the key is
      // genuinely ABSENT, not merely unreadable. Those are different failures
      // and the resolver distinguishes them.
      process.env.DOKIMA_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-nokey-'));
      dirs2.push(process.env.DOKIMA_HOME);
      try {
        const { app, id, h, dir } = await boot2();
        plantReceipt(dir);
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${id}/build-runs`,
          headers: h,
          payload: { actor_id: 'operator', run_id: 'run-haskey' },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().rule).toBe('signing-key-unset');
        expect(String(res.json().detail)).toMatch(/will NOT mint a replacement/);
        // And nothing was started.
        const after = await app.inject({
          method: 'GET',
          url: `/api/v1/projects/${id}/build-runs/run-haskey`,
          headers: h,
        });
        expect(after.statusCode).toBe(404);
      } finally {
        if (previous !== undefined) process.env.DOKIMA_SIGNING_KEY = previous;
        if (previousHome !== undefined) process.env.DOKIMA_HOME = previousHome;
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

describe('run stop (W17-06)', () => {
  const PORT3 = 4321;
  const TOKEN3 = 'test-token-w1706-0123456789';
  const dirs3: string[] = [];
  let active3: ApiServer | undefined;

  afterEach(async () => {
    await active3?.app.close();
    active3 = undefined;
    for (const d of dirs3.splice(0)) await fs.rm(d, { recursive: true, force: true });
  });

  async function boot3() {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-stoprun-'));
    dirs3.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN3,
      port: PORT3,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active3 = server;
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-stoprun-proj-'));
    dirs3.push(projectDir);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
      name: 'sr',
    });
    await fs.mkdir(path.join(projectDir, '.dokima'), { recursive: true });
    return {
      app: server.app,
      id: record.id,
      dir: projectDir,
      h: { host: `127.0.0.1:${PORT3}`, authorization: `Bearer ${TOKEN3}` },
    };
  }

  it('RED FIXTURE: a running build run can be STOPPED from the API — 202 stopping, ledgered with who asked; a second stop is a clean 409; an unknown run is 404', async () => {
    const previous = process.env.DOKIMA_SIGNING_KEY;
    process.env.DOKIMA_SIGNING_KEY = 'test-signing-key-w1706';
    try {
      const { app, id, dir, h } = await boot3();
      const start = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/build-runs`,
        headers: h,
        payload: { actor_id: 'operator', run_id: 'run-w1706' },
      });
      expect(start.statusCode).toBe(202);

      const stop = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/build-runs/run-w1706/stop`,
        headers: h,
        payload: { actor_id: 'brad' },
      });
      expect(stop.statusCode).toBe(202);
      expect(stop.json()).toMatchObject({ status: 'stopping' });

      const again = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/build-runs/run-w1706/stop`,
        headers: h,
        payload: { actor_id: 'brad' },
      });
      expect(again.statusCode).toBe(409);

      const unknown = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/build-runs/run-nope/stop`,
        headers: h,
        payload: {},
      });
      expect(unknown.statusCode).toBe(404);

      // Ledgered with who asked.
      const db = openEventLog(path.join(dir, '.dokima', 'state.db'));
      try {
        const events = listEvents(db).filter(
          (e) => e.eventType === 'run.stop_requested',
        );
        expect(events).toHaveLength(1);
        expect((events[0] as { actorId: string }).actorId).toBe('brad');
      } finally {
        db.close();
      }
    } finally {
      if (previous === undefined) delete process.env.DOKIMA_SIGNING_KEY;
      else process.env.DOKIMA_SIGNING_KEY = previous;
    }
  });
});
