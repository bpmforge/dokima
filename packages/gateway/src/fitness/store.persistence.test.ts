import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGlobalDb, type GlobalDb } from '@dokima/events';
import { FitnessCardStore } from './store.js';
import type { FitnessCard } from './types.js';

async function openTemp(): Promise<{ global: GlobalDb; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-fitness-store-test-'));
  return {
    global: openGlobalDb(path.join(dir, 'global.db')),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function card(overrides: Partial<FitnessCard> = {}): FitnessCard {
  return {
    model: 'qwen2.5-coder-7b-instruct',
    role: 'coding-agent',
    verdict: 'fit',
    harnessVersion: '1.0.0',
    taskResults: [{ taskId: 't1', passed: true, reason: 'ok' }],
    runAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('FitnessCardStore backed by global.db', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('put -> get round-trips through model_fitness, preserving taskResults', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    const store = new FitnessCardStore(t.global);
    const c = card();
    store.put(c);
    expect(store.get(c.model, c.role, c.harnessVersion)).toEqual(c);
    t.global.close();
  });

  it('is visible to a second store instance sharing the same handle (real persistence, not a private cache)', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    new FitnessCardStore(t.global).put(card());
    const reader = new FitnessCardStore(t.global);
    expect(
      reader.get('qwen2.5-coder-7b-instruct', 'coding-agent', '1.0.0')?.verdict,
    ).toBe('fit');
    t.global.close();
  });

  it('survives close/reopen of the underlying db file', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    new FitnessCardStore(t.global).put(card({ verdict: 'unfit' }));
    const dbPath = t.global.path;
    t.global.close();

    const reopened = openGlobalDb(dbPath);
    const store = new FitnessCardStore(reopened);
    expect(store.get('qwen2.5-coder-7b-instruct', 'coding-agent', '1.0.0')?.verdict).toBe(
      'unfit',
    );
    reopened.close();
  });

  it('all() lists every stored card from the db', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    const store = new FitnessCardStore(t.global);
    store.put(card({ role: 'coding-agent' }));
    store.put(card({ role: 'challenger', verdict: 'unfit' }));
    expect(store.all()).toHaveLength(2);
    t.global.close();
  });

  it('a store with no handle stays in-memory only (no db file created)', () => {
    const store = new FitnessCardStore();
    store.put(card());
    expect(store.get('qwen2.5-coder-7b-instruct', 'coding-agent', '1.0.0')).toEqual(
      card(),
    );
  });
});
