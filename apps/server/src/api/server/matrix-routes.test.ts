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

afterEach(async () => {
  await active?.app.close();
  active = undefined;
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function boot(): Promise<{ app: ApiServer['app']; id: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-matrix-home-'));
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
    expect(empty.json()).toEqual({ rows: [], copilot_enabled: false });

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
 * §4), so `defaultModelMatrixPreset` can't be validated against `PRESETS`
 * where it's actually written (`PUT /api/v1/settings/global`, handled in
 * scope-routes.ts — a flat, unvalidated pass-through by its own header
 * comment, and out of this ticket's write_scope to extend; see plan.json's
 * HANDOFF). This is the honest in-scope ceiling instead: apps/server
 * already carries its own third mirror of the preset name list
 * (`settings-types.ts`'s `MODEL_MATRIX_PRESETS`, zero consumers today) —
 * pinning it against the gateway's `PRESET_NAMES` here means the two
 * hand-kept lists can't silently drift without failing this gate, even
 * though the wire boundary itself isn't enforced yet.
 */
describe('AC5: MODEL_MATRIX_PRESETS mirror stays pinned to PRESET_NAMES', () => {
  it('settings-types.ts MODEL_MATRIX_PRESETS equals @dokima/gateway PRESET_NAMES', async () => {
    const { PRESET_NAMES } = await import('@dokima/gateway');
    const { MODEL_MATRIX_PRESETS } = await import('./settings-types.js');
    expect(MODEL_MATRIX_PRESETS).toEqual(PRESET_NAMES);
  });
});
