import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentity, mintReceipt, openEventLog } from '@shipwright/events';
import { claimTicket, closeTicket, createTicket, startTicket } from '@shipwright/tickets';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAllowlist } from './allowlist.js';
import { registerExportRoutes } from './export-routes.js';
import { registerProject } from './projects.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4601;
const SIGNING_KEY = 'test-minting-secret';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function authHeaders() {
  return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
}

describe('export/import routes (BLUEPRINT §12.8)', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: FastifyInstance; fleetHome: string }> {
    const fleetHome = await tmpDir('shipwright-export-fleet-');
    dirs.push(fleetHome);
    const app = Fastify({ logger: false });
    registerExportRoutes(app, {
      home: fleetHome,
      auth: { token: TOKEN, allowlist: buildAllowlist(PORT) },
    });
    await app.ready();
    apps.push(app);
    return { app, fleetHome };
  }

  async function registerSeededProject(fleetHome: string, name: string) {
    const projectDir = await tmpDir(`shipwright-export-project-${name}-`);
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'new',
      name,
    });

    const log = openEventLog(path.join(projectDir, '.shipwright', 'state.db'));
    createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
    createTicket(log, 'maker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Do the thing',
      lane: 'quality',
      writeScope: ['packages/shared/**'],
    });
    claimTicket(log, { ticketId: 'T-1', actorId: 'maker-1' });
    startTicket(log, { ticketId: 'T-1', actorId: 'maker-1' });
    closeTicket(log, {
      ticketId: 'T-1',
      actorId: 'maker-1',
      files: ['a.ts'],
      commits: ['abc123'],
      verify: { command: 'pnpm test', exitCode: 0 },
    });
    mintReceipt(
      log,
      {
        id: 'rcpt-1',
        kind: 'close',
        projectId: record.id,
        ticketId: 'T-1',
        validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
        inputFiles: [{ path: 'docs/SRS.md', content: 'v1' }],
        actorId: 'maker-1',
        payload: { note: 'close' },
      },
      { signingKey: SIGNING_KEY },
    );
    log.close();

    return { projectDir, projectId: record.id };
  }

  it('GET /export 404s for an unregistered project', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/nope/export',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /export requires auth (SC-08/D-005)', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/nope/export',
      headers: { host: `127.0.0.1:${PORT}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('exports the identities/events/receipts trio as a valid, hash-chained bundle', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerSeededProject(fleetHome, 'export-basic');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/export`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const bundle = res.json();
    expect(bundle.version).toBe(1);
    expect(bundle.projectId).toBe(projectId);
    expect(bundle.identities.length).toBeGreaterThanOrEqual(1);
    expect(bundle.events.length).toBeGreaterThan(0);
    expect(bundle.receipts).toHaveLength(1);
    expect(bundle.events[0].seq).toBe(1);
    expect(bundle.events[0].prevHash).toBe('0'.repeat(64));
  });

  it('round-trips: export a seeded project, import into a fresh one, board reconstructs', async () => {
    const { app, fleetHome } = await boot();
    const { projectId: sourceId } = await registerSeededProject(
      fleetHome,
      'export-source',
    );

    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${sourceId}/export`,
      headers: authHeaders(),
    });
    expect(exportRes.statusCode).toBe(200);
    const bundle = exportRes.json();

    const targetDir = await tmpDir('shipwright-export-target-');
    dirs.push(targetDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const targetRecord = await registerProject(registryPath, {
      path: targetDir,
      mode: 'new',
      name: 'import-target',
    });

    const importRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${targetRecord.id}/import`,
      headers: authHeaders(),
      payload: bundle,
    });
    expect(importRes.statusCode).toBe(201);
    const result = importRes.json();
    expect(result.events_imported).toBe(bundle.events.length);
    expect(result.receipts_imported).toBe(1);
    expect(result.chain).toEqual({ valid: true, brokenAtSeq: null, reason: null });
    expect(result.board).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticketId: 'T-1', status: 'in_review' }),
      ]),
    );

    const reExportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${targetRecord.id}/export`,
      headers: authHeaders(),
    });
    const reExported = reExportRes.json();
    expect(reExported.events).toEqual(bundle.events);
    expect(reExported.receipts).toEqual(bundle.receipts);
  });

  it('import refuses a non-empty target project (409, restore semantics not merge)', async () => {
    const { app, fleetHome } = await boot();
    const { projectId: sourceId } = await registerSeededProject(
      fleetHome,
      'export-conflict-src',
    );
    const { projectId: targetId } = await registerSeededProject(
      fleetHome,
      'export-conflict-dst',
    );

    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${sourceId}/export`,
      headers: authHeaders(),
    });
    const bundle = exportRes.json();

    const importRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${targetId}/import`,
      headers: authHeaders(),
      payload: bundle,
    });
    expect(importRes.statusCode).toBe(409);
  });

  it('import rejects a malformed bundle (400, structural validation)', async () => {
    const { app, fleetHome } = await boot();
    const targetDir = await tmpDir('shipwright-export-malformed-');
    dirs.push(targetDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: targetDir, mode: 'new' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/import`,
      headers: authHeaders(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/invalid export bundle/);
  });

  it('import rejects a bundle with a tampered hash chain (400, red fixture)', async () => {
    const { app, fleetHome } = await boot();
    const { projectId: sourceId } = await registerSeededProject(
      fleetHome,
      'export-tamper-src',
    );
    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${sourceId}/export`,
      headers: authHeaders(),
    });
    const bundle = exportRes.json();
    bundle.events[0].payloadJson = '{"tampered":true}';

    const targetDir = await tmpDir('shipwright-export-tamper-dst-');
    dirs.push(targetDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: targetDir, mode: 'new' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/import`,
      headers: authHeaders(),
      payload: bundle,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/hash chain is invalid/);
  });
});
