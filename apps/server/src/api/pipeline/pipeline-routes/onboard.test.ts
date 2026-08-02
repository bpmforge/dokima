import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { listTickets } from '@dokima/tickets';
import { openEventLogReader } from '@dokima/events';
import { registerProject } from '../../projects.js';
import { stateDbPath } from '../../server/board-project.js';
import { resetLoopModuleCacheForTests } from '../onboard-dispatch-port.js';
import { registerPipelineRoutes } from './index.js';
import { startFakeGatewayServer, type FakeGatewayServer } from '../test-fake-gateway.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function tmpGitProjectDir(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dokima-onboard-route-project-'),
  );
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'Dokima Test']);
  await git(dir, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(dir, 'README.md'), '# fixture\n');
  await git(dir, ['add', '--', 'README.md']);
  await git(dir, ['commit', '-m', 'chore: initial commit']);
  return dir;
}

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const COMPLETION = JSON.stringify({
  summary: 'Reviewed.',
  findings: [
    {
      title: 'Missing docs',
      severity: 'MEDIUM',
      recommendation: 'Add docs.',
      verify: 'true',
    },
  ],
});

describe('POST /api/v1/projects/:id/pipeline/onboard-run', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];
  const servers: FakeGatewayServer[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(servers.splice(0).map((s) => s.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
    resetLoopModuleCacheForTests();
  });

  it('starts and advances a real onboard run, persists the coverage manifest, and turns findings into real board tickets', async () => {
    const fleetHome = await tmpDir('dokima-onboard-route-home-');
    dirs.push(fleetHome);
    const projectDir = await tmpGitProjectDir();
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });

    const server = await startFakeGatewayServer([COMPLETION]);
    servers.push(server);

    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      onboardGatewayConfig: { baseUrl: server.url, model: 'local-model' },
    });
    await app.ready();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/pipeline/onboard-run`,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      run_id: string;
      coverage_manifest: { antiSlopRules: unknown[] };
      plan_items: { id: string; ticket_created: boolean }[];
    };
    expect(body.run_id).toBeTruthy();
    expect(body.coverage_manifest.antiSlopRules).toHaveLength(30);
    expect(body.plan_items).toHaveLength(16);
    expect(body.plan_items.every((i) => i.ticket_created)).toBe(true);

    const db = openEventLogReader(stateDbPath(projectDir));
    try {
      const tickets = listTickets({
        db,
        path: stateDbPath(projectDir),
        close: () => db.close(),
      });
      expect(tickets).toHaveLength(16);
    } finally {
      db.close();
    }
  });

  it('404s for an unregistered project id, never touching the gateway', async () => {
    const fleetHome = await tmpDir('dokima-onboard-route-home-');
    dirs.push(fleetHome);
    const server = await startFakeGatewayServer([COMPLETION]);
    servers.push(server);

    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      onboardGatewayConfig: { baseUrl: server.url, model: 'local-model' },
    });
    await app.ready();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/ghost/pipeline/onboard-run',
    });

    expect(response.statusCode).toBe(404);
    expect(server.requests).toHaveLength(0);
  });
});
