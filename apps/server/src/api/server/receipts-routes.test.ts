import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, mintReceipt, openEventLog } from '@dokima/events';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';

const TOKEN = 'test-token-0123456789abcdef';
const SIGNING_KEY = 'test-minting-secret';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('receipt routes — buildApiServer integration', () => {
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
    const fleetHome = await tmpDir('dokima-fleet-receipts-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: 4402,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  function authHeaders() {
    return { host: '127.0.0.1:4402', authorization: `Bearer ${TOKEN}` };
  }

  async function registerBareProject(fleetHome: string, name: string) {
    const projectDir = await tmpDir(`dokima-project-${name}-`);
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'new',
      name,
    });
    return { projectDir, projectId: record.id };
  }

  function seedReceipt(
    projectDir: string,
    projectId: string,
    overrides: { id: string; kind: 'gate' | 'coverage' | 'challenge'; ticketId?: string },
  ) {
    const dbPath = path.join(projectDir, '.dokima', 'state.db');
    const log = openEventLog(dbPath);
    if (!log.db.prepare('SELECT id FROM identities WHERE id = ?').get('maker-1')) {
      createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
    }
    mintReceipt(
      log,
      {
        id: overrides.id,
        kind: overrides.kind,
        projectId,
        ticketId: overrides.ticketId ?? null,
        validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
        inputFiles: [{ path: 'docs/SRS.md', content: 'v1' }],
        actorId: 'maker-1',
        payload: { note: overrides.kind },
      },
      { signingKey: SIGNING_KEY },
    );
    log.close();
  }

  it('GET /receipts/:id requires a project query param', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/receipts/whatever',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /receipts/:id returns a structured receipt in wire shape (FR-C5)', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerBareProject(
      fleetHome,
      'receipt-detail',
    );
    seedReceipt(projectDir, projectId, { id: 'rcpt-1', kind: 'gate', ticketId: 'W4-05' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/receipts/rcpt-1?project=${projectId}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: 'rcpt-1',
      kind: 'gate',
      ticket_id: 'W4-05',
      validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
      payload: { note: 'gate' },
    });
  });

  it('GET /receipts/:id 404s for an unknown receipt id', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerBareProject(fleetHome, 'receipt-missing');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/receipts/nope?project=${projectId}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /projects/:id/receipts is empty before any gate has run (UX_SPEC §2b)', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerBareProject(fleetHome, 'receipt-empty');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/receipts`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('GET /projects/:id/receipts lists newest-first and filters by kind', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerBareProject(
      fleetHome,
      'receipt-list',
    );
    seedReceipt(projectDir, projectId, { id: 'rcpt-a', kind: 'gate', ticketId: 'W4-05' });
    seedReceipt(projectDir, projectId, { id: 'rcpt-b', kind: 'coverage' });

    const allRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/receipts`,
      headers: authHeaders(),
    });
    expect(allRes.json().items.map((r: { id: string }) => r.id)).toEqual([
      'rcpt-b',
      'rcpt-a',
    ]);

    const filteredRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/receipts?kind=coverage`,
      headers: authHeaders(),
    });
    expect(filteredRes.json().items.map((r: { id: string }) => r.id)).toEqual(['rcpt-b']);
  });

  it('GET /projects/:id/approvals-ledger reports empty honestly (no migration exists yet)', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerBareProject(fleetHome, 'ledger-empty');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/approvals-ledger`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('404s for an unknown project id', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/nope/receipts',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('a corrupt fleet.json degrades to 503 problem+json, never an uncaught 500 (THREAT_MODEL §5.6)', async () => {
    const { app, fleetHome } = await boot();
    await registerBareProject(fleetHome, 'proj-corrupt');
    await fs.writeFile(path.join(fleetHome, 'fleet.json'), '{not valid json', 'utf8');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/whatever/approvals-ledger',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ rule: 'FLEET_REGISTRY_CORRUPT' });
  });
});
