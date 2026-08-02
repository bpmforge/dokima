import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4404;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('PATCH /tickets/:id — pre-build DAG edit (UX_SPEC §4 explain-refusals)', () => {
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
    const fleetHome = await tmpDir('dokima-ticket-edit-routes-');
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
    return {
      host: `127.0.0.1:${PORT}`,
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    };
  }

  async function registerBareProject(fleetHome: string, name: string) {
    const projectDir = await tmpDir(`dokima-ticket-edit-project-${name}-`);
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

  it('requires "project" query param', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tickets/T-1',
      headers: headers(),
      payload: { dependsOn: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed body', async () => {
    const { app, fleetHome } = await boot();
    const { id } = await registerBareProject(fleetHome, 'bad-body');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tickets/T-1?project=${id}`,
      headers: headers(),
      payload: { dependsOn: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unregistered project', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tickets/T-1?project=does-not-exist',
      headers: headers(),
      payload: { dependsOn: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s for a ticket id that does not exist in the project', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'no-ticket');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    log.close();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tickets/does-not-exist?project=${id}`,
      headers: headers(),
      payload: { dependsOn: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses (409, rule DEPENDS_ON_UNKNOWN_TICKET) a dependsOn on a nonexistent ticket', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'unknown-dep');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'A',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tickets/T-1?project=${id}`,
      headers: headers(),
      payload: { dependsOn: ['ghost-ticket'] },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { rule?: string };
    expect(body.rule).toBe('DEPENDS_ON_UNKNOWN_TICKET');
  });

  it('refuses (409, rule DEPENDS_ON_CYCLE) an edit that introduces a cycle', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'cycle');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'A',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    createTicket(log, 'agent-1', {
      id: 'T-2',
      type: 'task',
      title: 'B',
      lane: 'ui',
      writeScope: ['b/**'],
      dependsOn: ['T-1'],
    });
    log.close();

    // T-1 -> depends on T-2, but T-2 already depends on T-1: a direct cycle.
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tickets/T-1?project=${id}`,
      headers: headers(),
      payload: { dependsOn: ['T-2'] },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { rule?: string; detail?: string };
    expect(body.rule).toBe('DEPENDS_ON_CYCLE');
    expect(body.detail).toContain('T-1');
    expect(body.detail).toContain('T-2');
  });

  it('refuses (409, rule DEPENDS_ON_CYCLE) a self-dependency', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'self-dep');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'A',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tickets/T-1?project=${id}`,
      headers: headers(),
      payload: { dependsOn: ['T-1'] },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { rule?: string }).rule).toBe('DEPENDS_ON_CYCLE');
  });

  it('honestly reports 501/NOT_PERSISTED for a schema-valid edit (no update primitive yet)', async () => {
    const { app, fleetHome } = await boot();
    const { id, dbPath } = await registerBareProject(fleetHome, 'valid-edit');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
    createTicket(log, 'agent-1', {
      id: 'T-1',
      type: 'task',
      title: 'A',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    createTicket(log, 'agent-1', {
      id: 'T-2',
      type: 'task',
      title: 'B',
      lane: 'ui',
      writeScope: ['b/**'],
    });
    log.close();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tickets/T-1?project=${id}`,
      headers: headers(),
      payload: { dependsOn: ['T-2'] },
    });
    expect(res.statusCode).toBe(501);
    expect((res.json() as { rule?: string }).rule).toBe('NOT_PERSISTED');
  });
});
