import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listModelMatrix, putModelMatrix } from './model-matrix-store.js';

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
