import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, openEventLog } from '@shipwright/events';
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  createTicket,
  startTicket,
} from '@shipwright/tickets';
import { buildApiServer, type ApiServer } from './server.js';
import {
  archiveProject,
  computeFleetRegistryPath,
  listProjectCards,
  ProjectDirectoryError,
  ProjectNotFoundError,
  registerProject,
} from './projects.js';

const TOKEN = 'test-token-0123456789abcdef';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Seeds one ready, one blocked (via unmet dep), and one done ticket. */
function seedTickets(dbPath: string): void {
  const log = openEventLog(dbPath);
  try {
    createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
    createIdentity(log, { id: 'reviewer-1', name: 'Reviewer', kind: 'machine' });
    createTicket(log, 'maker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Ready one',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    createTicket(log, 'maker-1', {
      id: 'T-2',
      type: 'task',
      title: 'Blocked one',
      lane: 'ui',
      writeScope: ['b/**'],
      dependsOn: ['T-1'],
    });
    createTicket(log, 'maker-1', {
      id: 'T-3',
      type: 'task',
      title: 'Done one',
      lane: 'ui',
      writeScope: ['c/**'],
    });
    claimTicket(log, { ticketId: 'T-3', actorId: 'maker-1' });
    startTicket(log, { ticketId: 'T-3', actorId: 'maker-1' });
    closeTicket(log, {
      ticketId: 'T-3',
      actorId: 'maker-1',
      files: ['c/x.ts'],
      commits: ['abc123'],
      verify: { command: 'pnpm test', exitCode: 0 },
    });
    acceptTicket(log, { ticketId: 'T-3', actorId: 'reviewer-1' });
  } finally {
    log.close();
  }
}

describe('registerProject / archiveProject / listProjectCards', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function freshRegistry(): Promise<string> {
    const home = await tmpDir('shipwright-fleet-home-');
    dirs.push(home);
    return computeFleetRegistryPath(home);
  }

  it('mode "new" creates the directory and an initialized state.db', async () => {
    const registryPath = await freshRegistry();
    const projectDir = path.join(await tmpDir('shipwright-fleet-parent-'), 'my-product');
    dirs.push(path.dirname(projectDir));

    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });

    expect(record.archived).toBe(false);
    expect(record.name).toBe('my-product');
    await expect(fs.stat(projectDir)).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, '.shipwright', 'state.db')),
    ).resolves.toBeDefined();
  });

  it('mode "onboard"/"import" refuse a directory that does not exist', async () => {
    const registryPath = await freshRegistry();
    const missing = path.join(os.tmpdir(), `shipwright-fleet-missing-${Date.now()}`);

    await expect(
      registerProject(registryPath, { path: missing, mode: 'onboard' }),
    ).rejects.toBeInstanceOf(ProjectDirectoryError);
    await expect(
      registerProject(registryPath, { path: missing, mode: 'import' }),
    ).rejects.toBeInstanceOf(ProjectDirectoryError);
  });

  it('registering the same path twice reactivates the same record (reopen flow, G-10f)', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-reopen-');
    dirs.push(projectDir);

    const first = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
    });
    await archiveProject(registryPath, first.id);
    const archivedCards = await listProjectCards(registryPath, { archived: true });
    expect(archivedCards).toHaveLength(1);
    expect(archivedCards[0]?.id).toBe(first.id);

    const reopened = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
    });
    expect(reopened.id).toBe(first.id);
    expect(reopened.archived).toBe(false);

    const active = await listProjectCards(registryPath, { archived: false });
    expect(active.map((c) => c.id)).toEqual([first.id]);
    const stillArchived = await listProjectCards(registryPath, { archived: true });
    expect(stillArchived).toEqual([]);
  });

  it('archiveProject refuses an unknown id', async () => {
    const registryPath = await freshRegistry();
    await expect(archiveProject(registryPath, 'not-a-real-id')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('archive never touches the project directory (FR-F2: state travels with the repo dir)', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-archive-keep-');
    dirs.push(projectDir);
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
    });

    await archiveProject(registryPath, record.id);

    await expect(fs.stat(projectDir)).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, '.shipwright', 'state.db')),
    ).resolves.toBeDefined();
  });

  it('computes live board stats (ready/blocked/done) from the project state.db', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-board-');
    dirs.push(projectDir);
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });
    seedTickets(path.join(record.path, '.shipwright', 'state.db'));

    const cards = await listProjectCards(registryPath, { archived: false });
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.board).toEqual({ ready: 1, blocked: 1, done: 1 });
    // Not-yet-implemented card fields degrade honestly rather than faking data.
    expect(card.phase).toBeNull();
    expect(card.berthsRunning).toBe(0);
    expect(card.heartbeatAgeMs).toBeNull();
    expect(card.pendingDecideCount).toBe(0);
    expect(card.spendTodayUsd).toBe(0);
  });

  it('a project with no state.db yet reports zeroed stats instead of throwing', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-nodb-');
    dirs.push(projectDir);
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
    });
    await fs.rm(path.join(record.path, '.shipwright'), { recursive: true, force: true });

    const cards = await listProjectCards(registryPath, { archived: false });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.board).toEqual({ ready: 0, blocked: 0, done: 0 });
  });

  it('an unmigrated (pre-tables) state.db degrades to zeroed stats without logging', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-unmigrated-');
    dirs.push(projectDir);
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
    });
    const dbPath = path.join(record.path, '.shipwright', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    // A 0-byte file is a valid, empty SQLite database with none of @shipwright/events'
    // migrated tables — the exact "old schema" shape computeProjectStats degrades for.
    await fs.writeFile(dbPath, '');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cards = await listProjectCards(registryPath, { archived: false });
      expect(cards[0]?.board).toEqual({ ready: 0, blocked: 0, done: 0 });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('an unreadable/corrupt state.db degrades to zeroed stats AND logs the unexpected error', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-corrupt-');
    dirs.push(projectDir);
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
    });
    const dbPath = path.join(record.path, '.shipwright', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, 'not a sqlite database, just garbage bytes');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cards = await listProjectCards(registryPath, { archived: false });
      expect(cards[0]?.board).toEqual({ ready: 0, blocked: 0, done: 0 });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain(dbPath);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('board stats reflect events injected after the first read (live, not cached)', async () => {
    const registryPath = await freshRegistry();
    const projectDir = await tmpDir('shipwright-fleet-live-');
    dirs.push(projectDir);
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });

    const before = await listProjectCards(registryPath, { archived: false });
    expect(before[0]?.board).toEqual({ ready: 0, blocked: 0, done: 0 });

    seedTickets(path.join(record.path, '.shipwright', 'state.db'));

    const after = await listProjectCards(registryPath, { archived: false });
    expect(after[0]?.board).toEqual({ ready: 1, blocked: 1, done: 1 });
  });
});

describe('project routes — buildApiServer integration', () => {
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
    const fleetHome = await tmpDir('shipwright-fleet-routes-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: 4400,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  function authHeaders(port = 4400) {
    return { host: `127.0.0.1:${port}`, authorization: `Bearer ${TOKEN}` };
  }

  it('rejects an unauthenticated GET /api/v1/projects with 401', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { host: '127.0.0.1:4400' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/projects starts empty', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: [] });
  });

  it('POST /api/v1/projects rejects a missing mode/path with 400', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { path: '/tmp/whatever' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ status: 400 });
  });

  it('POST /api/v1/projects (mode=new) creates and lists a project card in wire shape', async () => {
    const { app, fleetHome } = await boot();
    const projectDir = path.join(fleetHome, 'created-product');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { path: projectDir, mode: 'new', name: 'Created Product' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created).toMatchObject({
      path: projectDir,
      name: 'Created Product',
      archived: false,
      phase: null,
      board: { ready: 0, blocked: 0, done: 0 },
      berths_running: 0,
      heartbeat_age_ms: null,
      pending_decide_count: 0,
      spend_today: 0,
    });
    expect(typeof created.id).toBe('string');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    expect(listRes.json()).toEqual({ projects: [created] });
  });

  it('archive moves a project out of the default list and into ?archived=true', async () => {
    const { app, fleetHome } = await boot();
    const projectDir = path.join(fleetHome, 'archive-me');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = createRes.json();

    const archiveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/archive`,
      headers: authHeaders(),
    });
    expect(archiveRes.statusCode).toBe(200);
    expect(archiveRes.json()).toMatchObject({ id, archived: true });

    const activeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    expect(activeRes.json()).toEqual({ projects: [] });

    const archivedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects?archived=true',
      headers: authHeaders(),
    });
    expect(archivedRes.json().projects).toHaveLength(1);
    expect(archivedRes.json().projects[0].id).toBe(id);
  });

  it('archiving an unknown id returns 404', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/does-not-exist/archive',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });
});
