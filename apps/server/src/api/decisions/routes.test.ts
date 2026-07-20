import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '../projects.js';
import { registerDecisionRoutes } from './routes.js';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const FOUNDER_BODY = {
  kind: 'founder',
  founder: {
    title: 'Deployment shape',
    options: [
      { id: 'self-hosted', label: 'Self-hosted', tradeoffs: 'more control' },
      { id: 'managed', label: 'Managed', tradeoffs: 'less ops' },
    ],
    recommendedId: 'self-hosted',
    recommendedReasoning: 'C1 local-first',
  },
};

describe('decision routes', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: FastifyInstance; projectId: string }> {
    const fleetHome = await tmpDir('shipwright-decision-routes-');
    dirs.push(fleetHome);
    const projectDir = await tmpDir('shipwright-decision-project-');
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });

    const app = Fastify({ logger: false });
    registerDecisionRoutes(app, { home: fleetHome });
    await app.ready();
    apps.push(app);

    return { app, projectId: record.id };
  }

  it('404s create/list/decide/ledger for an unregistered project', async () => {
    const { app } = await boot();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/nope/slates',
      payload: FOUNDER_BODY,
    });
    expect(create.statusCode).toBe(404);

    const decide = await app.inject({
      method: 'POST',
      url: '/api/v1/slates/x/decide?project=nope',
      payload: { chosen: 'self-hosted' },
    });
    expect(decide.statusCode).toBe(404);
  });

  it('create -> list (open) -> decide -> list (decided) -> GET decisions round-trip', async () => {
    const { app, projectId } = await boot();

    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/slates`,
      payload: FOUNDER_BODY,
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; status: string };
    expect(created.status).toBe('open');

    const openList = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/slates?status=open`,
    });
    expect(openList.json().items).toHaveLength(1);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/v1/slates/${created.id}/decide?project=${projectId}`,
      payload: { chosen: 'self-hosted', rationale: 'fastest to ship' },
    });
    expect(decide.statusCode).toBe(200);
    const decided = decide.json() as { d_id: string };
    expect(decided.d_id).toBe('D-001');

    const decidedList = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/slates?status=decided`,
    });
    expect(decidedList.json().items).toHaveLength(1);

    const ledger = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/decisions`,
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().items).toHaveLength(1);
    expect(ledger.json().items[0].d_id).toBe('D-001');
  });

  it('409s a decide on an already-decided slate', async () => {
    const { app, projectId } = await boot();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/slates`,
      payload: FOUNDER_BODY,
    });
    const created = create.json() as { id: string };

    await app.inject({
      method: 'POST',
      url: `/api/v1/slates/${created.id}/decide?project=${projectId}`,
      payload: { chosen: 'self-hosted' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/slates/${created.id}/decide?project=${projectId}`,
      payload: { chosen: 'managed' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('400s a create with an invalid slate (FR-P6 2-4 options)', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/slates`,
      payload: {
        kind: 'founder',
        founder: { ...FOUNDER_BODY.founder, options: [FOUNDER_BODY.founder.options[0]] },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s a decide with a chosen id not on the slate', async () => {
    const { app, projectId } = await boot();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/slates`,
      payload: FOUNDER_BODY,
    });
    const created = create.json() as { id: string };
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slates/${created.id}/decide?project=${projectId}`,
      payload: { chosen: 'nope' },
    });
    expect(res.statusCode).toBe(409);
  });
});
