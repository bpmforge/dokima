import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGlobalDb, putModelFitness } from '@dokima/events';
import { loadFitnessCards } from './roster-fitness.js';

const tmpDirs: string[] = [];
async function tmpGlobalDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-roster-fitness-'));
  tmpDirs.push(dir);
  return path.join(dir, 'global.db');
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('loadFitnessCards', () => {
  it('returns an empty list when global.db does not exist yet (never bench-run, C-1 honesty)', async () => {
    const dbPath = path.join(
      os.tmpdir(),
      `dokima-roster-fitness-missing-${Date.now()}.db`,
    );
    expect(await loadFitnessCards('sdlc-lead', { globalDbPath: dbPath })).toEqual([]);
  });

  it('returns cards recorded for the role, excluding other roles', async () => {
    const dbPath = await tmpGlobalDbPath();
    const global = openGlobalDb(dbPath);
    putModelFitness(global, {
      model: 'qwen2.5-coder-32b-instruct',
      role: 'sdlc-lead',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [{ taskId: 't1', passed: true, reason: 'ok' }],
      runAt: '2026-07-15T00:00:00.000Z',
    });
    putModelFitness(global, {
      model: 'claude-sonnet-5',
      role: 'code-reviewer',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: '2026-07-15T00:00:00.000Z',
    });
    global.close();

    const cards = await loadFitnessCards('sdlc-lead', { globalDbPath: dbPath });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      model: 'qwen2.5-coder-32b-instruct',
      role: 'sdlc-lead',
    });
  });
});
