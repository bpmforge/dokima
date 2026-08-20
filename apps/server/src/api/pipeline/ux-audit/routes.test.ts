/**
 * W13-55. The route-level red fixture from the ticket: a scripted judge
 * returns one finding with a real citation and one fabricated; the real one
 * reaches the plan, the fabricated one is dropped AND the drop is logged.
 * Law 9(a): the "model" is a fake HTTP gateway, never a live call.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { listEvents, openEventLog } from '@dokima/events';
import { registerProject, computeFleetRegistryPath } from '../../projects.js';
import { stateDbPath } from '../../server/board-project.js';
import { startFakeGatewayServer, type FakeGatewayServer } from '../test-fake-gateway.js';
import { loadEvidenceStates, registerUxAuditRoutes } from './routes.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
const servers: FakeGatewayServer[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const ROSTER_EVIDENCE = {
  strings: [
    'Agent Roster',
    'No model will take this role yet — pick models in Settings → Models.',
  ],
  interactive: [{ name: 'Roster' }],
  geometry: { viewport: { w: 1280, h: 720 }, contentBox: { x: 0, y: 0, w: 800, h: 400 }, occupancy: 0.35 },
  classHistogram: { roster__expert: 3 },
};

async function boot(judgeReply: string) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-uxaudit-home-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-uxaudit-proj-'));
  dirs.push(home, projectDir);
  const evidenceDir = path.join(projectDir, 'docs', 'tour', 'img');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, '10-roster.evidence.json'),
    JSON.stringify(ROSTER_EVIDENCE),
  );
  const record = await registerProject(computeFleetRegistryPath(home), {
    path: projectDir,
    mode: 'new',
  });
  const gateway = await startFakeGatewayServer([judgeReply]);
  servers.push(gateway);
  const app = Fastify({ logger: false });
  registerUxAuditRoutes(app, {
    home,
    gatewayConfig: { baseUrl: gateway.url, model: 'local-judge' },
  });
  await app.ready();
  apps.push(app);
  return { app, projectId: record.id, projectDir };
}

describe('POST /api/v1/projects/:id/ux-audit (W13-55)', () => {
  it('RED FIXTURE: the verified finding reaches the plan; the fabricated one is dropped and the drop is logged', async () => {
    const { app, projectId, projectDir } = await boot(
      JSON.stringify({
        findings: [
          {
            id: 'roster-instruction',
            state: '10-roster',
            problem: 'The roster instruction may drift from the tabs.',
            severity: 'high',
            citation: 'pick models in Settings → Models',
            fixSummary: 'Keep validate-ui-copy green.',
          },
          {
            id: 'invented-crisis',
            state: '10-roster',
            problem: 'A confabulated finding.',
            severity: 'critical',
            citation: 'this text appears nowhere in the product',
            fixSummary: 'Should never become work.',
          },
        ],
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/ux-audit`,
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      created_ids: string[];
      dropped: { id: string; reason: string }[];
      verified: number;
    };
    expect(body.created_ids).toEqual(['UX-roster-instruction']);
    expect(body.verified).toBe(1);
    expect(body.dropped).toHaveLength(1);
    expect(body.dropped[0]!.id).toBe('invented-crisis');
    expect(body.dropped[0]!.reason).toContain('citation not present');

    // Durable, not just in the response: the plan row exists and the drop is
    // in the event log (Law 4 — the run explains itself).
    const log = openEventLog(stateDbPath(projectDir));
    try {
      const rows = log.db
        .prepare('SELECT catalog_id FROM plan_items')
        .all() as { catalog_id: string }[];
      expect(rows.map((r) => r.catalog_id)).toEqual(['UX-roster-instruction']);
      const judged = listEvents(log).filter((e) => e.eventType === 'ux_audit.judged');
      expect(judged).toHaveLength(1);
      const payload = judged[0]!.payload as { dropped: { id: string }[] };
      expect(payload.dropped.map((d) => d.id)).toEqual(['invented-crisis']);
    } finally {
      log.close();
    }
  });

  it('is idempotent per finding: a second run files nothing new for the same catalog id', async () => {
    const reply = JSON.stringify({
      findings: [
        {
          id: 'roster-instruction',
          state: '10-roster',
          problem: 'Same finding again.',
          severity: 'high',
          citation: 'Agent Roster',
        },
      ],
    });
    const { app, projectId } = await boot(reply);
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/ux-audit`,
      payload: {},
    });
    expect((first.json() as { created_ids: string[] }).created_ids).toHaveLength(1);
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/ux-audit`,
      payload: {},
    });
    expect((second.json() as { created_ids: string[] }).created_ids).toHaveLength(0);
  });

  it('a project with no evidence packs is told to run the tour, not judged on nothing', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-uxaudit-home-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-uxaudit-proj-'));
    dirs.push(home, projectDir);
    const record = await registerProject(computeFleetRegistryPath(home), {
      path: projectDir,
      mode: 'new',
    });
    const app = Fastify({ logger: false });
    registerUxAuditRoutes(app, { home, gatewayConfig: { baseUrl: 'http://127.0.0.1:9', model: 'x' } });
    await app.ready();
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/ux-audit`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { detail: string }).detail).toContain('capture tour');
  });

  it('loadEvidenceStates names states by relative path, dark pass included', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-evidence-'));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, 'dark'), { recursive: true });
    await fs.writeFile(path.join(dir, '01-fleet.evidence.json'), JSON.stringify({ strings: ['Fleet'] }));
    await fs.writeFile(
      path.join(dir, 'dark', '01-fleet.evidence.json'),
      JSON.stringify({ strings: ['Fleet'] }),
    );
    const states = await loadEvidenceStates(dir);
    expect(states.map((s) => s.id)).toEqual(['01-fleet', 'dark/01-fleet']);
  });
});
