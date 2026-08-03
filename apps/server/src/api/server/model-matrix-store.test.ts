import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listModelMatrix,
  listProjectModelMatrix,
  putGlobalModelMatrix,
  putModelMatrix,
} from './model-matrix-store.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dokima-model-matrix-'));
}

describe('model matrix store', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('starts empty for a fresh project (no table created by a read)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    expect(await listModelMatrix(dir)).toEqual([]);
  });

  it('upserts rows and returns the full matrix', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const now = () => '2026-07-15T00:00:00.000Z';

    const rows = await putModelMatrix(
      dir,
      [
        { role: 'coding-agent', taskType: 'code', model: 'local/qwen', fallback: [] },
        {
          role: 'challenger',
          taskType: 'verification',
          model: 'copilot/gpt-4',
          fallback: ['local/qwen'],
        },
      ],
      now,
    );
    expect(rows).toEqual([
      {
        role: 'challenger',
        taskType: 'verification',
        model: 'copilot/gpt-4',
        fallback: ['local/qwen'],
        updatedAt: now(),
      },
      {
        role: 'coding-agent',
        taskType: 'code',
        model: 'local/qwen',
        fallback: [],
        updatedAt: now(),
      },
    ]);

    const listed = await listModelMatrix(dir);
    expect(listed).toEqual(rows);
  });

  it('a second PUT overwrites the same (role, task_type) row instead of duplicating it', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await putModelMatrix(dir, [
      { role: 'coding-agent', taskType: 'code', model: 'local/a', fallback: [] },
    ]);
    const updated = await putModelMatrix(dir, [
      { role: 'coding-agent', taskType: 'code', model: 'local/b', fallback: ['local/a'] },
    ]);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ model: 'local/b', fallback: ['local/a'] });
  });
});

/**
 * W10-64 red fixtures. The user-visible claim is "configure the model once and
 * a product you create afterwards uses it" — FR-F3, which `global-db/
 * providers.ts` states verbatim in its own docstring and which was false for
 * the model even after W10-62 made it true for the provider.
 *
 * Both directions, because a global preset that overrode an explicit project
 * choice would be a worse bug than the one being fixed.
 */
describe('model matrix global preset (W10-64)', () => {
  const dirs: string[] = [];
  const savedHome = process.env.DOKIMA_HOME;

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
    if (savedHome === undefined) delete process.env.DOKIMA_HOME;
    else process.env.DOKIMA_HOME = savedHome;
  });

  async function scopedHome(): Promise<string> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-matrix-home-'));
    dirs.push(home);
    process.env.DOKIMA_HOME = home;
    return home;
  }

  const ROW = {
    role: 'coding-agent',
    taskType: 'reasoning' as const,
    model: 'qwen3.6-35b-a3b',
    fallback: [],
  };

  it('THE ACCEPTANCE TEST: a SECOND product inherits a model configured once', async () => {
    await scopedHome();
    await putGlobalModelMatrix([ROW]);

    const brandNewProject = await tmpProjectDir();
    dirs.push(brandNewProject);

    const resolved = await listModelMatrix(brandNewProject);

    expect(resolved.map((r) => r.model)).toEqual(['qwen3.6-35b-a3b']);
  });

  it('a project with its OWN rows ignores the global preset entirely', async () => {
    await scopedHome();
    await putGlobalModelMatrix([ROW]);
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await putModelMatrix(dir, [{ ...ROW, model: 'project-choice-wins' }]);

    const resolved = await listModelMatrix(dir);

    expect(resolved.map((r) => r.model)).toEqual(['project-choice-wins']);
  });

  it('does not MERGE scopes row-by-row — a project override is a clean replacement', async () => {
    await scopedHome();
    await putGlobalModelMatrix([
      ROW,
      { role: 'code-reviewer', taskType: 'verification', model: 'global-only', fallback: [] },
    ]);
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await putModelMatrix(dir, [{ ...ROW, model: 'project-choice' }]);

    const resolved = await listModelMatrix(dir);

    // `code-reviewer` is NOT inherited alongside the project row: a half-merged
    // matrix, where a role you never configured here silently comes from
    // elsewhere, is harder to reason about than a clean override.
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.role).toBe('coding-agent');
  });

  it('no preset at either scope is the normal first-run state, not an error (C-1)', async () => {
    await scopedHome();
    const dir = await tmpProjectDir();
    dirs.push(dir);
    expect(await listModelMatrix(dir)).toEqual([]);
  });

  it('a corrupt global preset degrades to empty rather than running on the half that parsed', async () => {
    const home = await scopedHome();
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({ model_matrix: [ROW, { role: 'broken' }] }),
    );
    const dir = await tmpProjectDir();
    dirs.push(dir);

    expect(await listModelMatrix(dir)).toEqual([]);
  });

  it('listProjectModelMatrix never reports inherited rows — the PUT route diffs against it', async () => {
    await scopedHome();
    await putGlobalModelMatrix([ROW]);
    const dir = await tmpProjectDir();
    dirs.push(dir);

    expect(await listProjectModelMatrix(dir)).toEqual([]);
    expect(await listModelMatrix(dir)).toHaveLength(1);
  });
});
