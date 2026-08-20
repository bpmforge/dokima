import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApiServer, type ApiServer } from '../server.js';
import { registerProject, computeFleetRegistryPath } from '../projects.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4412;

const dirs: string[] = [];
let active: ApiServer | undefined;

const savedDokimaHome = process.env.DOKIMA_HOME;

afterEach(async () => {
  await active?.app.close();
  active = undefined;
  if (savedDokimaHome === undefined) delete process.env.DOKIMA_HOME;
  else process.env.DOKIMA_HOME = savedDokimaHome;
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function boot(): Promise<{ app: ApiServer['app']; id: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-matrix-home-'));
  // W10-64. `fleetHome` scopes the project registry but NOT the global
  // settings file: `putGlobalSetting` resolves ~/.dokima from DOKIMA_HOME.
  // Without this line a scope=global PUT in a test writes the developer's
  // REAL ~/.dokima/config.json — caught the hard way, it did exactly that on
  // this machine and would have pointed every project at a fixture model.
  process.env.DOKIMA_HOME = home;
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-matrix-proj-'));
  dirs.push(home, projectDir);
  const record = await registerProject(computeFleetRegistryPath(home), {
    path: projectDir,
    mode: 'new',
  });
  const server = await buildApiServer({
    token: TOKEN,
    port: PORT,
    isDbOpen: () => true,
    logger: false,
    fleetHome: home,
  });
  active = server;
  return { app: server.app, id: record.id };
}

const headers = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };

async function putMatrix(
  app: ApiServer['app'],
  id: string,
  rows: readonly Record<string, unknown>[],
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/projects/${id}/model-matrix`,
    headers,
    payload: { rows },
  });
}

describe('model-matrix routes (API_DESIGN §89)', () => {
  it('starts empty and round-trips a PUT', async () => {
    const { app, id } = await boot();
    const empty = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
    });
    // W10-64 added `scope`, which reports where the returned rows came from.
    // A project with no rows of its own resolves the global preset, so an
    // empty matrix reads as `global` — there is nothing project-scoped yet.
    expect(empty.json()).toEqual({ rows: [], copilot_enabled: false, scope: 'global' });

    const put = await putMatrix(app, id, [
      { role: 'coding-agent', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
    ]);
    expect(put.statusCode).toBe(200);
    expect(put.json().rows[0]).toMatchObject({
      role: 'coding-agent',
      task_type: 'code',
      model: 'qwen2.5-coder-7b-instruct',
    });
  });

  it('rejects a malformed rows payload with a 400', async () => {
    const { app, id } = await boot();
    const res = await putMatrix(app, id, [{ role: 'coding-agent' } as never]);
    expect(res.statusCode).toBe(400);
  });
});

describe('model-matrix PUT: maker != verifier at configuration time (W10-42 AC4, FR-G2/C-4)', () => {
  /** RED FIXTURE (C-4): a single PUT that sets both roles to the same model is refused wholesale, nothing written. */
  it('refuses a same-PUT collision and persists neither row', async () => {
    const { app, id } = await boot();
    const res = await putMatrix(app, id, [
      { role: 'coding-agent', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
      { role: 'code-reviewer', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().rule).toBe('same-model-refused');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
    });
    expect(get.json().rows).toEqual([]);
  });

  it('refuses a verifier row that collides with an already-stored maker row', async () => {
    const { app, id } = await boot();
    const seed = await putMatrix(app, id, [
      { role: 'coding-agent', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
    ]);
    expect(seed.statusCode).toBe(200);

    const res = await putMatrix(app, id, [
      { role: 'challenger', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().rule).toBe('same-model-refused');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
    });
    expect(get.json().rows.map((r: { role: string }) => r.role)).toEqual([
      'coding-agent',
    ]);
  });

  it('allows distinct models for maker and verifier roles', async () => {
    const { app, id } = await boot();
    const res = await putMatrix(app, id, [
      { role: 'coding-agent', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
      { role: 'code-reviewer', task_type: 'code', model: 'claude-opus-4-8' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(2);
  });

  it('allows a verifier row when no maker row exists yet for that task type', async () => {
    const { app, id } = await boot();
    const res = await putMatrix(app, id, [
      { role: 'code-reviewer', task_type: 'escalation', model: 'claude-opus-4-8' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(1);
  });

  /** The reverse direction: a submitted maker row colliding with an already-stored verifier row is caught too, not just verifier-submitted-against-stored-maker. */
  it('refuses a maker row that collides with an already-stored verifier row', async () => {
    const { app, id } = await boot();
    const seed = await putMatrix(app, id, [
      { role: 'code-reviewer', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
    ]);
    expect(seed.statusCode).toBe(200);

    const res = await putMatrix(app, id, [
      { role: 'coding-agent', task_type: 'code', model: 'qwen2.5-coder-7b-instruct' },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().rule).toBe('same-model-refused');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
    });
    expect(get.json().rows.map((r: { role: string }) => r.role)).toEqual([
      'code-reviewer',
    ]);
  });
});

/**
 * AC5 (revised): apps/web has no `@dokima/gateway` dependency (ARCHITECTURE
 * §4), so `defaultModelMatrixPreset` can't be validated against `PRESETS` in
 * the browser. The wire boundary IS enforced now, in scope-routes.ts's
 * `PUT /api/v1/settings/global` (`refuseUnknownPreset`, 400 problem+json
 * `rule: 'unknown-preset'` — see settings-routes.test.ts's red fixture for
 * that). This test covers the remaining honest gap: apps/server also
 * carries its own third mirror of the preset name list
 * (`settings-types.ts`'s `MODEL_MATRIX_PRESETS`, zero consumers today) —
 * pinning it against the gateway's `PRESET_NAMES` here means the two
 * hand-kept lists can't silently drift either.
 */
describe('AC5: MODEL_MATRIX_PRESETS mirror stays pinned to PRESET_NAMES', () => {
  it('settings-types.ts MODEL_MATRIX_PRESETS equals @dokima/gateway PRESET_NAMES', async () => {
    const { PRESET_NAMES } = await import('@dokima/gateway');
    const { MODEL_MATRIX_PRESETS } = await import('./settings-types.js');
    expect(MODEL_MATRIX_PRESETS).toEqual(PRESET_NAMES);
  });
});

/**
 * W10-64: the write path. A global READ fallback with no way to write the
 * preset would be dead code, so these assert the route can actually put one —
 * and that it still defaults to project scope, because every existing caller
 * (the e2e specs, the CLI, the panel before this ticket) sends no scope at all.
 */
describe('model-matrix scope (W10-64)', () => {
  it('defaults to project scope when the body names none', async () => {
    const { app, id } = await boot();

    const put = await putMatrix(app, id, [
      { role: 'coding-agent', task_type: 'code', model: 'project-model' },
    ]);

    expect(put.statusCode).toBe(200);
    expect(put.json().scope).toBe('project');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
    });
    expect(get.json().scope).toBe('project');
  });

  it('writes the every-project preset when scope is global, and reports it as inherited', async () => {
    const { app, id } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
      payload: {
        scope: 'global',
        rows: [{ role: 'coding-agent', task_type: 'code', model: 'every-project-model' }],
      },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().scope).toBe('global');

    // The project itself still has no rows, so the GET resolves the preset
    // and says so — that `scope: 'global'` is what the panel renders as
    // "these come from your every-project defaults".
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
    });
    expect(get.json().scope).toBe('global');
    expect(get.json().rows[0]).toMatchObject({ model: 'every-project-model' });
  });

  it('refuses an unknown scope rather than silently treating it as project', async () => {
    const { app, id } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
      payload: {
        scope: 'globl',
        rows: [{ role: 'coding-agent', task_type: 'code', model: 'x' }],
      },
    });

    expect(put.statusCode).toBe(400);
  });
});

/**
 * W13-37. The wizard's body shape. These tests exist because the tier
 * direction is a SILENT inversion: hand `strong` the model the user picked to
 * write code and every role gets the wrong one, with no error anywhere — the
 * run just costs more and reviews get worse.
 */
describe('model-matrix routes — preset expansion (W13-37)', () => {
  async function putPreset(
    app: ApiServer['app'],
    id: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/model-matrix`,
      headers,
      payload,
    });
  }

  it('expands a preset into rows using the user\'s own two models', async () => {
    const { app, id } = await boot();
    const res = await putPreset(app, id, {
      preset: 'hybrid',
      strong: 'their-review-model',
      cheap: 'their-work-model',
      scope: 'global',
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as { role: string; model: string; fallback: string[] }[];
    // Every canonical role gets a row, and no row names a model the caller
    // did not supply — the presets shipped model ids until W13-36.
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      expect(['their-review-model', 'their-work-model']).toContain(row.model);
    }
    // THE DIRECTION CHECK: the maker runs on the cheaper pick, the reviewer
    // and challenger on the stronger one.
    const byRole = new Map(rows.map((r) => [r.role, r.model]));
    expect(byRole.get('coding-agent')).toBe('their-work-model');
    expect(byRole.get('code-reviewer')).toBe('their-review-model');
    expect(byRole.get('challenger')).toBe('their-review-model');
    // Each role falls back to the other tier, so one unloaded model parks a
    // role rather than failing the run.
    const maker = rows.find((r) => r.role === 'coding-agent');
    expect(maker?.fallback).toEqual(['their-review-model']);
  });

  it('refuses a preset whose two models are the same (C-4)', async () => {
    const { app, id } = await boot();
    const res = await putPreset(app, id, {
      preset: 'all-local',
      strong: 'one-model',
      cheap: 'one-model',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail ?? res.json().title).toMatch(/same|different/i);
  });

  it('refuses an unknown preset name and a blank model', async () => {
    const { app, id } = await boot();
    const bad = await putPreset(app, id, { preset: 'nope', strong: 'a', cheap: 'b' });
    expect(bad.statusCode).toBe(400);
    const blank = await putPreset(app, id, { preset: 'hybrid', strong: '  ', cheap: 'b' });
    expect(blank.statusCode).toBe(400);
  });
});
