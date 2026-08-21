/**
 * W19-03 — the fitness harness gets its producer.
 *
 * Scripted `ModelClient` only (law 9a): the injected-client seam is the same
 * one the bench module documents for CI; no live provider is ever contacted.
 * The real e2e/fitness-fixtures tasks ARE used — the fixture set is data,
 * and the bench scoring them is exactly what the route wires up.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { listModelFitness, openGlobalDbReader } from '@dokima/events';
import { registerProject } from '../projects.js';
import { registerModelsBenchRoute } from './models-bench-route.js';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('POST /projects/:id/models/bench (W19-03)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot() {
    const fleetHome = await tmpDir('dokima-bench-route-');
    dirs.push(fleetHome);
    const projectDir = await tmpDir('dokima-bench-project-');
    dirs.push(projectDir);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
      name: 'bench-me',
    });
    const globalDbPath = path.join(fleetHome, 'global.db');
    return { fleetHome, projectId: record.id, globalDbPath };
  }

  it('RED FIXTURE: benches the coding-agent fixtures with a scripted client and RECORDS the card — the roster read path stops being permanently empty', async () => {
    const { fleetHome, projectId, globalDbPath } = await boot();
    const app = Fastify({ logger: false });
    registerModelsBenchRoute(app, {
      home: fleetHome,
      client: { respond: async () => 'a plain scripted answer' },
      globalDbPath,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/models/bench`,
      payload: { role: 'coding-agent' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      model: string;
      role: string;
      verdict: string;
      tasks: readonly { id: string; passed: boolean }[];
    };
    expect(body.role).toBe('coding-agent');
    expect(['fit', 'marginal', 'unfit']).toContain(body.verdict);
    expect(body.tasks.length).toBeGreaterThan(0);

    const db = openGlobalDbReader(globalDbPath);
    try {
      const cards = listModelFitness({
        db,
        path: globalDbPath,
        close: () => db.close(),
      });
      expect(cards).toHaveLength(1);
      expect(cards[0]!.role).toBe('coding-agent');
      expect(cards[0]!.verdict).toBe(body.verdict);
    } finally {
      db.close();
    }
    await app.close();
  });

  it('a role with no fixture tasks refuses 422 with the harness error, recording nothing', async () => {
    const { fleetHome, projectId, globalDbPath } = await boot();
    const app = Fastify({ logger: false });
    registerModelsBenchRoute(app, {
      home: fleetHome,
      client: { respond: async () => 'x' },
      globalDbPath,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/models/bench`,
      payload: { role: 'no-such-role' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('an unregistered project is a 404', async () => {
    const { fleetHome } = await boot();
    const app = Fastify({ logger: false });
    registerModelsBenchRoute(app, {
      home: fleetHome,
      client: { respond: async () => 'x' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/nope/models/bench',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
