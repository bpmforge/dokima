import { describe, expect, it } from 'vitest';
import {
  createInMemoryRoutingEventSink,
  SameModelRefusedError,
} from './maker-verifier.js';
import { PRESET_HYBRID } from './presets.js';
import { RoutingUnresolvedError } from './matrix.js';
import { route } from './router.js';
import type { ScopedRoleMatrix } from './types.js';

const matrix: ScopedRoleMatrix = { global: PRESET_HYBRID };

describe('route', () => {
  it('resolves task routing alone when no maker context is supplied', async () => {
    const result = await route({
      matrix,
      role: 'coding-agent',
      taskType: 'code',
      actorId: 'harbormaster',
    });
    expect(result.chain[0]).toBe('qwen2.5-coder-7b-instruct');
    expect(result.overrideEvent).toBeUndefined();
  });

  it('does not guard non-verifier roles even when passed maker context', async () => {
    const result = await route({
      matrix,
      role: 'test-engineer',
      taskType: 'code',
      actorId: 'harbormaster',
      makerRole: 'coding-agent',
      makerModel: 'qwen2.5-coder-7b-instruct',
    });
    expect(result.overrideEvent).toBeUndefined();
  });

  it('resolves a verifier role that legitimately differs from the maker (the Hybrid preset default)', async () => {
    const maker = await route({
      matrix,
      role: 'coding-agent',
      taskType: 'code',
      actorId: 'harbormaster',
    });
    const reviewer = await route({
      matrix,
      role: 'code-reviewer',
      taskType: 'code',
      actorId: 'harbormaster',
      makerRole: 'coding-agent',
      makerModel: maker.chain[0],
    });
    expect(reviewer.chain[0]).toBe('claude-opus-4-8');
    expect(reviewer.chain[0]).not.toBe(maker.chain[0]);
    expect(reviewer.overrideEvent).toBeUndefined();
  });

  it('refuses when a verifier role would collide with the maker model, with no override', async () => {
    const collidingMatrix: ScopedRoleMatrix = {
      global: {
        'coding-agent': { default: { model: 'shared-model', fallbackChain: [] } },
        'code-reviewer': { default: { model: 'shared-model', fallbackChain: [] } },
      },
    };
    await expect(
      route({
        matrix: collidingMatrix,
        role: 'code-reviewer',
        taskType: 'code',
        actorId: 'harbormaster',
        makerRole: 'coding-agent',
        makerModel: 'shared-model',
      }),
    ).rejects.toThrow(SameModelRefusedError);
  });

  it('allows the collision and emits the override event when explicitly configured', async () => {
    const collidingMatrix: ScopedRoleMatrix = {
      global: {
        'coding-agent': { default: { model: 'shared-model', fallbackChain: [] } },
        challenger: { default: { model: 'shared-model', fallbackChain: [] } },
      },
    };
    const sink = createInMemoryRoutingEventSink();
    const result = await route({
      matrix: collidingMatrix,
      role: 'challenger',
      taskType: 'code',
      actorId: 'user:founder',
      makerRole: 'coding-agent',
      makerModel: 'shared-model',
      overrideSettings: { run: { challenger: true } },
      sink,
    });
    expect(result.chain[0]).toBe('shared-model');
    expect(result.overrideEvent?.scope).toBe('run');
    expect(sink.events).toHaveLength(1);
  });

  it('propagates RoutingUnresolvedError for an unknown role with no default fallback', async () => {
    await expect(
      route({ matrix: {}, role: 'ghost', taskType: 'code', actorId: 'harbormaster' }),
    ).rejects.toThrow(RoutingUnresolvedError);
  });
});
