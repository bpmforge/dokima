import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PlanEvaluationSnapshot } from '@shipwright/pipeline';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApiServer, type ApiServer } from './server.js';
import { registerProject } from './projects.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4501;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function baselineSnapshot(
  overrides: Partial<PlanEvaluationSnapshot> = {},
): PlanEvaluationSnapshot {
  return {
    phase: null,
    receipts: { staleCount: 0 },
    coverage: { requiredSkipped: 0 },
    findings: { openCriticalUnwaived: 0 },
    rules: { fpHeavyCount: 0 },
    tickets: { oscillatingCount: 0, blockedWithEvidenceMaxAgeDays: 0 },
    spend: { thresholdBreachRepeatCount: 0 },
    gates: { missingRedFixtureCount: 0 },
    providers: { unverifiedTosCount: 0 },
    deliverables: { orphanedCount: 0 },
    planItems: { regressedCount: 0 },
    playbook: { staleEntryCount: 0 },
    ...overrides,
  };
}

describe('plans routes', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{
    app: ApiServer['app'];
    projectId: string;
  }> {
    const fleetHome = await tmpDir('shipwright-plans-routes-');
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-a');
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
    });
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, projectId: record.id };
  }

  function authHeaders() {
    return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
  }

  it('GET /plan on a fresh project is empty with an all-zero funnel', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/plan`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [],
      funnel: { raw_findings: 0, plan_items: 0, accepted: 0, done: 0, regressed: 0 },
    });
  });

  it('GET /plan on an unknown project is 404', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/ghost/plan',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('evaluate rejects a malformed snapshot with 400', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan/evaluate`,
      headers: authHeaders(),
      payload: { snapshot: { phase: null } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('evaluate -> GET /plan renders catalog provenance + verify criterion + state (AC1)', async () => {
    const { app, projectId } = await boot();
    const evaluate = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan/evaluate`,
      headers: authHeaders(),
      payload: { snapshot: baselineSnapshot({ receipts: { staleCount: 5 } }) },
    });
    expect(evaluate.statusCode).toBe(201);
    expect(
      evaluate.json().created.map((c: { catalog_id: string }) => c.catalog_id),
    ).toContain('PC-001');

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/plan`,
      headers: authHeaders(),
    });
    const item = list
      .json()
      .items.find((i: { catalog_id: string }) => i.catalog_id === 'PC-001');
    expect(item).toMatchObject({
      catalog_id: 'PC-001',
      state: 'proposed',
      verify_criterion: 'receipts.staleCount == 0',
      ticket_id: null,
    });
    expect(list.json().funnel).toEqual({
      raw_findings: 1,
      plan_items: 1,
      accepted: 0,
      done: 0,
      regressed: 0,
    });
  });

  it('accept requires a lane and mints a linked ticket carrying verify verbatim', async () => {
    const { app, projectId } = await boot();
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan/evaluate`,
      headers: authHeaders(),
      payload: { snapshot: baselineSnapshot({ receipts: { staleCount: 1 } }) },
    });

    const missingLane = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan-items/PC-001/accept`,
      headers: authHeaders(),
      payload: {},
    });
    expect(missingLane.statusCode).toBe(400);

    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan-items/PC-001/accept`,
      headers: authHeaders(),
      payload: { lane: 'pipeline' },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({
      item: { state: 'accepted', ticket_id: 'PLAN-PC-001' },
      ticket_created: true,
    });

    const board = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/tickets`,
      headers: authHeaders(),
    });
    const ticket = board.json().items.find((t: { id: string }) => t.id === 'PLAN-PC-001');
    expect(ticket).toMatchObject({
      lane: 'pipeline',
      verify: 'receipts.staleCount == 0',
    });
  });

  it('accept on an unknown item is 404', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan-items/ghost/accept`,
      headers: authHeaders(),
      payload: { lane: 'pipeline' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('dismiss requires a note and excludes the item from the default list (AC1 dismiss action)', async () => {
    const { app, projectId } = await boot();
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan/evaluate`,
      headers: authHeaders(),
      payload: { snapshot: baselineSnapshot({ receipts: { staleCount: 1 } }) },
    });

    const missingNote = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan-items/PC-001/dismiss`,
      headers: authHeaders(),
      payload: {},
    });
    expect(missingNote.statusCode).toBe(400);

    const dismiss = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan-items/PC-001/dismiss`,
      headers: authHeaders(),
      payload: { note: 'not applicable' },
    });
    expect(dismiss.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/plan`,
      headers: authHeaders(),
    });
    expect(list.json().items).toHaveLength(0);
    expect(list.json().funnel.raw_findings).toBe(1);
  });

  it(
    'SECURITY (CRITICAL, SC-03/law 4): verify ignores a caller-supplied body.snapshot ' +
      'entirely — a fabricated satisfying snapshot does NOT flip an accepted item to done',
    async () => {
      const { app, projectId } = await boot();
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/plan/evaluate`,
        headers: authHeaders(),
        payload: { snapshot: baselineSnapshot({ receipts: { staleCount: 1 } }) },
      });
      const accept = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/plan-items/PC-001/accept`,
        headers: authHeaders(),
        payload: { lane: 'pipeline' },
      });
      expect(accept.json().item.state).toBe('accepted');

      // The ticket's own red-fixture example — a fabricated, structurally
      // incomplete snapshot claiming `receipts.staleCount == 0` (PC-001's
      // verify criterion) is satisfied. Under the pre-fix route this shape
      // would have been rejected as malformed (400); under the fix it
      // doesn't matter at all — body.snapshot is never read.
      const fabricated = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/plan/verify`,
        headers: authHeaders(),
        payload: { snapshot: { receipts: { staleCount: 0 } } },
      });
      expect(fabricated.statusCode).toBe(200);
      // `receipts.staleCount` has no live producer yet (scheduler/snapshot.ts)
      // -> the whole pass is skipped, same as the real scheduler would.
      expect(fabricated.json()).toEqual({ verified: [], regressed: [], skipped: true });

      // A fully well-formed, fully-satisfying fabricated snapshot changes nothing either.
      const fullyFabricated = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/plan/verify`,
        headers: authHeaders(),
        payload: { snapshot: baselineSnapshot() },
      });
      expect(fullyFabricated.json()).toEqual({
        verified: [],
        regressed: [],
        skipped: true,
      });

      // Omitting body.snapshot entirely produces the identical outcome — proof
      // the response never depended on what the caller sent.
      const noBody = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/plan/verify`,
        headers: authHeaders(),
      });
      expect(noBody.json()).toEqual(fabricated.json());

      const list = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/plan`,
        headers: authHeaders(),
      });
      const item = list
        .json()
        .items.find((i: { catalog_id: string }) => i.catalog_id === 'PC-001');
      expect(item.state).toBe('accepted');
    },
  );

  it('verify on a fresh project with no verifiable items runs (not skipped) and reports nothing', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/plan/verify`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: [], regressed: [], skipped: false });
  });
});
