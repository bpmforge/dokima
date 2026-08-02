import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGlobalDb, type GlobalDb } from './db.js';
import { getModelFitness, listModelFitness, putModelFitness } from './model-fitness.js';

async function openTemp(): Promise<{ global: GlobalDb; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-model-fitness-test-'));
  return {
    global: openGlobalDb(path.join(dir, 'global.db')),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe('model_fitness', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('returns undefined for a (model, role, harnessVersion) never put', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    expect(getModelFitness(t.global, 'unknown', 'coding-agent', '1.0.0')).toBeUndefined();
    t.global.close();
  });

  it('round-trips put -> get, preserving the receipt payload', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    putModelFitness(t.global, {
      model: 'qwen2.5-coder-7b-instruct',
      role: 'coding-agent',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [{ taskId: 't1', passed: true, reason: 'ok' }],
      runAt: '2026-07-16T00:00:00.000Z',
    });
    const record = getModelFitness(
      t.global,
      'qwen2.5-coder-7b-instruct',
      'coding-agent',
      '1.0.0',
    );
    expect(record).toEqual({
      model: 'qwen2.5-coder-7b-instruct',
      role: 'coding-agent',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [{ taskId: 't1', passed: true, reason: 'ok' }],
      runAt: '2026-07-16T00:00:00.000Z',
    });
    t.global.close();
  });

  it('keys are distinct per (model, role, harnessVersion) — a new harness version does not overwrite the old card', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    putModelFitness(t.global, {
      model: 'm',
      role: 'coding-agent',
      verdict: 'unfit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: 'a',
    });
    putModelFitness(t.global, {
      model: 'm',
      role: 'coding-agent',
      verdict: 'fit',
      harnessVersion: '2.0.0',
      receiptPayload: [],
      runAt: 'b',
    });
    expect(getModelFitness(t.global, 'm', 'coding-agent', '1.0.0')?.verdict).toBe(
      'unfit',
    );
    expect(getModelFitness(t.global, 'm', 'coding-agent', '2.0.0')?.verdict).toBe('fit');
    t.global.close();
  });

  it('putting the same (model, role, harnessVersion) again upserts', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    putModelFitness(t.global, {
      model: 'm',
      role: 'coding-agent',
      verdict: 'unfit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: 'a',
    });
    putModelFitness(t.global, {
      model: 'm',
      role: 'coding-agent',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: 'b',
    });
    const rows = listModelFitness(t.global);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe('fit');
    expect(rows[0]?.runAt).toBe('b');
    t.global.close();
  });

  it('listModelFitness lists every stored card', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    putModelFitness(t.global, {
      model: 'm',
      role: 'coding-agent',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: 'a',
    });
    putModelFitness(t.global, {
      model: 'm',
      role: 'challenger',
      verdict: 'unfit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: 'b',
    });
    expect(listModelFitness(t.global)).toHaveLength(2);
    t.global.close();
  });

  it('rejects an unknown verdict (CHECK constraint)', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    expect(() =>
      putModelFitness(t.global, {
        model: 'm',
        role: 'coding-agent',
        // @ts-expect-error deliberately invalid for the CHECK-constraint test
        verdict: 'excellent',
        harnessVersion: '1.0.0',
        receiptPayload: [],
        runAt: 'a',
      }),
    ).toThrow(/CHECK/i);
    t.global.close();
  });

  it('persists across close/reopen of the same file', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    putModelFitness(t.global, {
      model: 'm',
      role: 'coding-agent',
      verdict: 'marginal',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: 'a',
    });
    const dbPath = t.global.path;
    t.global.close();
    const reopened = openGlobalDb(dbPath);
    expect(getModelFitness(reopened, 'm', 'coding-agent', '1.0.0')?.verdict).toBe(
      'marginal',
    );
    reopened.close();
  });
});
