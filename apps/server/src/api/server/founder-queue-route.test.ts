/**
 * W20-09 (D-030): the funnel route. The property under test is the one the
 * trust model rests on — what is open is what is returned, in the mechanical
 * order, with nothing filtered out on the way.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog } from '@dokima/events';
import { closeTicket, createTicket, claimTicket, startTicket } from '@dokima/tickets';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';
import { createSlate } from '../decisions/store.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4419;

async function tmpDir(p: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), p));
}

describe('GET /projects/:id/founder-queue (W20-09)', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot() {
    const fleetHome = await tmpDir('dokima-fq-home-');
    dirs.push(fleetHome);
    const projectDir = await tmpDir('dokima-fq-proj-');
    dirs.push(projectDir);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
      name: 'queue',
    });
    await fs.mkdir(path.join(projectDir, '.dokima'), { recursive: true });
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, projectId: record.id, projectDir };
  }

  function headers() {
    return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
  }

  function seed(projectDir: string) {
    const log = openEventLog(path.join(projectDir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    createIdentity(log, { id: 'coding-agent', name: 'Sam', kind: 'machine' });
    return log;
  }

  it('a project with nothing open returns depth 0 — never an error the founder must interpret', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/founder-queue`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ depth: 0, items: [] });
  });

  it('RED FIXTURE: everything open is returned and DEPTH EQUALS THE ITEM COUNT — a route that filtered would show a smaller depth than the truth', async () => {
    const { app, projectId, projectDir } = await boot();
    const log = seed(projectDir);
    try {
      createSlate(
        log,
        {
          kind: 'founder' as const,
          founder: {
            title: 'Local-only accounts, or synced?',
            options: [
              { id: 'local', label: 'Local-only', tradeoffs: 'nothing leaves the device' },
              { id: 'synced', label: 'Synced', tradeoffs: 'cloud backup, more moving parts' },
            ],
            recommendedId: 'local',
            recommendedReasoning: 'smallest threat model',
          },
        },
        { actorId: 'operator' },
      );
      for (const id of ['T-1', 'T-2']) {
        createTicket(log, 'operator', {
          id,
          type: 'task',
          title: `ticket ${id}`,
          lane: 'core',
          writeScope: ['src/**'],
          ...(id === 'T-2' ? { dependsOn: ['T-1'] } : {}),
        });
      }
      // T-1 is finished and waiting on a human verb — an acceptance item that
      // also blocks T-2, so the DAG signal has something real to count.
      claimTicket(log, { ticketId: 'T-1', actorId: 'coding-agent' });
      startTicket(log, { ticketId: 'T-1', actorId: 'coding-agent' });
      closeTicket(log, {
        ticketId: 'T-1',
        actorId: 'coding-agent',
        files: ['src/a.ts'],
        verify: { command: 'pnpm test', exitCode: 0 },
        commits: ['abc1234'],
      });
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/founder-queue`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      depth: number;
      items: { id: string; kind: string; position: number; reason: string; title: string }[];
    };
    // the invariant: depth is the true count, because nothing is filtered
    expect(body.depth).toBe(body.items.length);
    expect(body.depth).toBeGreaterThanOrEqual(1);
    expect(body.items.some((i) => i.kind === 'founder-decision')).toBe(true);
    // W21-34: the acceptance path runs through this handler and was never
    // asserted — the reason a code read had to stand in for evidence.
    expect(body.items.some((i) => i.kind === 'acceptance')).toBe(true);
    // W21-34: and it says what the machine review did. T-1 was never reviewed,
    // so accepting it means being the only check — which the item must say.
    const accept = body.items.find((i) => i.kind === 'acceptance');
    expect(accept!.title).toContain('nothing has checked this but you');
    // positions are dense and 1-based — a gap would mean something was dropped
    expect(body.items.map((i) => i.position)).toEqual(
      body.items.map((_, idx) => idx + 1),
    );
    for (const i of body.items) expect(i.reason.length).toBeGreaterThan(0);
  });

  it('an unregistered project is a 404, not an empty queue that looks like calm', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/nope/founder-queue',
      headers: headers(),
    });
    expect(res.statusCode).toBe(404);
  });
});
