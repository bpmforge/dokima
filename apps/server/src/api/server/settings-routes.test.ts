import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listEvents, openEventLog } from '@shipwright/events';
import { buildApiServer, type ApiServer } from '../server.js';
import { registerProject } from '../projects.js';
import { stateDbPath } from './settings-db.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4401;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('settings routes', () => {
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
    fleetHome: string;
    projectId: string;
    projectDir: string;
  }> {
    const fleetHome = await tmpDir('shipwright-settings-routes-');
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
    return { app: server.app, fleetHome, projectId: record.id, projectDir };
  }

  function eventTypes(projectDir: string): string[] {
    const log = openEventLog(stateDbPath(projectDir));
    try {
      return listEvents(log).map((e) => e.eventType);
    } finally {
      log.close();
    }
  }

  function authHeaders() {
    return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
  }

  it('GET model-matrix on an unknown project returns 404', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/ghost/model-matrix',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PUT then GET model-matrix round-trips and flags Copilot-backed rows once enabled', async () => {
    const { app, projectId, projectDir } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/model-matrix`,
      headers: authHeaders(),
      payload: {
        rows: [
          { role: 'coding-agent', task_type: 'code', model: 'local/qwen' },
          { role: 'challenger', task_type: 'verification', model: 'copilot/gpt-4' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().copilot_enabled).toBe(false);
    const copilotRow = put
      .json()
      .rows.find((r: { role: string }) => r.role === 'challenger');
    expect(copilotRow.copilot_backed).toBe(true);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/model-matrix`,
      headers: authHeaders(),
    });
    expect(get.json().rows).toHaveLength(2);

    // DATABASE.md §6/§8, FR-S3: model_matrix is a settings change, so the PUT
    // must mint a real settings.changed event, not just upsert the table row.
    expect(eventTypes(projectDir)).toContain('settings.changed');
  });

  it('PUT model-matrix rejects a malformed row with 400', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/model-matrix`,
      headers: authHeaders(),
      payload: { rows: [{ role: 'coding-agent' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('project settings PUT/GET round-trips and the effective view names the winning scope', async () => {
    const { app, projectId } = await boot();
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/settings`,
      headers: authHeaders(),
      payload: { berths: 3 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ berths: 3 });

    const effective = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/settings/effective`,
      headers: authHeaders(),
    });
    expect(effective.json().berths).toMatchObject({ value: 3, winning_scope: 'project' });
  });

  it('autonomy GET always includes the immutable never_auto list, and PUT rejects an invalid mode', async () => {
    const { app, projectId } = await boot();
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/autonomy`,
      headers: authHeaders(),
    });
    expect(get.json().mode).toBe('interactive');
    expect(get.json().never_auto.length).toBeGreaterThan(0);

    const badPut = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/autonomy`,
      headers: authHeaders(),
      payload: { mode: 'yolo' },
    });
    expect(badPut.statusCode).toBe(400);

    const goodPut = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/autonomy`,
      headers: authHeaders(),
      payload: { mode: 'auto' },
    });
    expect(goodPut.json().mode).toBe('auto');
  });

  it('budget GET/PUT exposes the 70/85/100 breaker thresholds alongside the caps', async () => {
    const { app, projectId } = await boot();
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/budget`,
      headers: authHeaders(),
      payload: { run_limit_usd: 5, project_limit_usd: 50 },
    });
    expect(put.json()).toEqual({
      run_limit_usd: 5,
      project_limit_usd: 50,
      breaker_thresholds: { warn: 0.7, downshift: 0.85, hard_stop: 1 },
    });
  });

  it('rule lifecycle: register -> promote is refused below the sample minimum -> demote', async () => {
    const { app, projectId } = await boot();
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/rules/R-01/register`,
      headers: authHeaders(),
    });

    const promote1 = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/rules/R-01/promote`,
      headers: authHeaders(),
    });
    expect(promote1.json().state).toBe('shadow');

    const promote2 = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/rules/R-01/promote`,
      headers: authHeaders(),
    });
    expect(promote2.json().state).toBe('advisory');

    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/rules/R-01/promote`,
      headers: authHeaders(),
      payload: { min_sample_count: 100 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().rule).toBe('BELOW_SAMPLE_MINIMUM');

    const demoted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/rules/R-01/demote`,
      headers: authHeaders(),
    });
    expect(demoted.json().state).toBe('shadow');

    const rules = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/rules`,
      headers: authHeaders(),
    });
    expect(rules.json().rules).toHaveLength(1);
  });

  it('suppression review: create requires a justification + human signature, then lists', async () => {
    const { app, projectId } = await boot();
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/findings/fp-1/suppress`,
      headers: authHeaders(),
      payload: { justification: 'not_a_real_reason', signature: 'Bradford' },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/findings/fp-1/suppress`,
      headers: authHeaders(),
      payload: {
        justification: 'false_positive',
        signature: 'Bradford Matthews',
        context_key: 'ctx-1',
      },
    });
    expect(good.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/suppressions`,
      headers: authHeaders(),
    });
    expect(list.json().suppressions).toHaveLength(1);
  });

  it('Copilot consent gate: default-off, requires acknowledge:true, mints an ack event', async () => {
    const { app, projectId } = await boot();
    const initial = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/copilot-consent`,
      headers: authHeaders(),
    });
    expect(initial.json().enabled).toBe(false);
    expect(initial.json().warning).toContain('ban');

    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/copilot-consent`,
      headers: authHeaders(),
      payload: {},
    });
    expect(refused.statusCode).toBe(400);

    const enabled = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/copilot-consent`,
      headers: authHeaders(),
      payload: { acknowledge: true },
    });
    expect(enabled.json().enabled).toBe(true);
    expect(typeof enabled.json().acknowledged_at).toBe('string');

    const matrixAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/model-matrix`,
      headers: authHeaders(),
    });
    expect(matrixAfter.json().copilot_enabled).toBe(true);
  });

  it('SECURITY (red fixture): a direct PUT {copilotEnabled:true} through the generic settings endpoint is refused and does not enable Copilot', async () => {
    const { app, projectId } = await boot();

    const bypassAttempt = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/settings`,
      headers: authHeaders(),
      payload: { copilotEnabled: true },
    });
    expect(bypassAttempt.statusCode).toBe(403);
    expect(bypassAttempt.json().rule).toBe('consent-gated-key');

    const consent = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/copilot-consent`,
      headers: authHeaders(),
    });
    expect(consent.json().enabled).toBe(false);

    const matrix = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/model-matrix`,
      headers: authHeaders(),
    });
    expect(matrix.json().copilot_enabled).toBe(false);

    // A mixed body (gated key alongside a legitimate one) is refused wholesale — never
    // silently applies the safe key while dropping the gated one.
    const mixedAttempt = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/settings`,
      headers: authHeaders(),
      payload: { autonomy: 'auto', copilotEnabled: true },
    });
    expect(mixedAttempt.statusCode).toBe(403);
    const settingsAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/settings`,
      headers: authHeaders(),
    });
    expect(settingsAfter.json().autonomy).toBeUndefined();

    // Same blocklist on the global-scope generic PUT — defense in depth, even though
    // matrix-routes.ts/consent-routes.ts only ever read the project-scope key today.
    const globalBypassAttempt = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/global',
      headers: authHeaders(),
      payload: { copilotEnabled: true },
    });
    expect(globalBypassAttempt.statusCode).toBe(403);
    expect(globalBypassAttempt.json().rule).toBe('consent-gated-key');

    // The real consent-gate endpoint still works — the fix blocks only the generic PUT.
    const properEnable = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/copilot-consent`,
      headers: authHeaders(),
      payload: { acknowledge: true },
    });
    expect(properEnable.json().enabled).toBe(true);
  });

  it('guide route degrades to markdown:null for a topic with no content yet', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/guide/settings-model-matrix',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ topic: 'settings-model-matrix', markdown: null });
  });
});
