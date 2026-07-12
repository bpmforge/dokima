import { describe, expect, it } from 'vitest';
import { FitnessCardStore } from './store.js';
import type { FitnessCard } from './types.js';

function card(overrides: Partial<FitnessCard> = {}): FitnessCard {
  return {
    model: 'qwen2.5-coder-7b-instruct',
    role: 'coding-agent',
    verdict: 'fit',
    harnessVersion: '1.0.0',
    taskResults: [],
    runAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('FitnessCardStore', () => {
  it('returns undefined for a (model, role, harnessVersion) never put', () => {
    const store = new FitnessCardStore();
    expect(store.get('unknown-model', 'coding-agent', '1.0.0')).toBeUndefined();
  });

  it('round-trips put -> get', () => {
    const store = new FitnessCardStore();
    const c = card();
    store.put(c);
    expect(store.get(c.model, c.role, c.harnessVersion)).toEqual(c);
  });

  it('keys are distinct per role', () => {
    const store = new FitnessCardStore();
    store.put(card({ role: 'coding-agent', verdict: 'fit' }));
    store.put(card({ role: 'challenger', verdict: 'unfit' }));
    expect(store.get('qwen2.5-coder-7b-instruct', 'coding-agent', '1.0.0')?.verdict).toBe(
      'fit',
    );
    expect(store.get('qwen2.5-coder-7b-instruct', 'challenger', '1.0.0')?.verdict).toBe(
      'unfit',
    );
  });

  it('keys are distinct per harnessVersion — a new version does not overwrite the old card', () => {
    const store = new FitnessCardStore();
    store.put(card({ harnessVersion: '1.0.0', verdict: 'unfit' }));
    store.put(card({ harnessVersion: '2.0.0', verdict: 'fit' }));
    expect(store.get('qwen2.5-coder-7b-instruct', 'coding-agent', '1.0.0')?.verdict).toBe(
      'unfit',
    );
    expect(store.get('qwen2.5-coder-7b-instruct', 'coding-agent', '2.0.0')?.verdict).toBe(
      'fit',
    );
  });

  it('putting the same (model, role, harnessVersion) again overwrites', () => {
    const store = new FitnessCardStore();
    store.put(card({ verdict: 'unfit' }));
    store.put(card({ verdict: 'fit' }));
    expect(store.get('qwen2.5-coder-7b-instruct', 'coding-agent', '1.0.0')?.verdict).toBe(
      'fit',
    );
  });

  it('all() lists every stored card', () => {
    const store = new FitnessCardStore();
    store.put(card({ role: 'coding-agent' }));
    store.put(card({ role: 'challenger' }));
    expect(store.all()).toHaveLength(2);
  });
});
