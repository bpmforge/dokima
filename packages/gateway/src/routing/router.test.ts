import { describe, expect, it } from 'vitest';
import {
  createInMemoryRoutingEventSink,
  SameModelRefusedError,
} from './maker-verifier.js';
import { RoutingUnresolvedError } from './matrix.js';
import { PRESET_HYBRID } from './presets.js';
import { route } from './router.js';
import type { ScopedRoleMatrix } from './types.js';

const matrix: ScopedRoleMatrix = { global: PRESET_HYBRID };

describe('route', () => {
  it('resolves task routing alone for a non-verifier role, no maker context needed', async () => {
    const result = await route({
      matrix,
      role: 'coding-agent',
      taskType: 'code',
      actorId: 'harbormaster',
    });
    expect(result.chain[0]).toBe('qwen2.5-coder-7b-instruct');
    expect(result.overrideEvent).toBeUndefined();
  });

  it('resolves a verifier role that legitimately differs from the maker (the Hybrid preset default) with zero extra params', async () => {
    const reviewer = await route({
      matrix,
      role: 'code-reviewer',
      taskType: 'code',
      actorId: 'harbormaster',
    });
    expect(reviewer.chain[0]).toBe('claude-opus-4-8');
    expect(reviewer.overrideEvent).toBeUndefined();
  });

  it(
    'the guard is structural, not caller-triggered: a verifier-role collision is refused even when ' +
      'the caller never mentions a maker role or model (FR-G2 default)',
    async () => {
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
        }),
      ).rejects.toThrow(SameModelRefusedError);
    },
  );

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
      overrideSettings: { run: { challenger: true } },
      sink,
    });
    expect(result.chain[0]).toBe('shared-model');
    expect(result.overrideEvent?.scope).toBe('run');
    expect(sink.events).toHaveLength(1);
  });

  it('honors an explicit makerRole override when the comparison should not be against coding-agent', async () => {
    const collidingMatrix: ScopedRoleMatrix = {
      global: {
        'pm-interviewer': { default: { model: 'shared-model', fallbackChain: [] } },
        challenger: { default: { model: 'shared-model', fallbackChain: [] } },
        'coding-agent': { default: { model: 'other-model', fallbackChain: [] } },
      },
    };
    // Default maker (coding-agent) resolves to a different model, so this would
    // NOT collide with the default — but explicitly naming pm-interviewer as the
    // maker role must still trigger the guard against its model.
    await expect(
      route({
        matrix: collidingMatrix,
        role: 'challenger',
        taskType: 'code',
        actorId: 'harbormaster',
        makerRole: 'pm-interviewer',
      }),
    ).rejects.toThrow(SameModelRefusedError);
  });

  it('non-verifier roles are never guarded, even on a same-model matrix', async () => {
    const collidingMatrix: ScopedRoleMatrix = {
      global: {
        'coding-agent': { default: { model: 'shared-model', fallbackChain: [] } },
        'test-engineer': { default: { model: 'shared-model', fallbackChain: [] } },
      },
    };
    const result = await route({
      matrix: collidingMatrix,
      role: 'test-engineer',
      taskType: 'code',
      actorId: 'harbormaster',
    });
    expect(result.chain[0]).toBe('shared-model');
    expect(result.overrideEvent).toBeUndefined();
  });

  it('propagates RoutingUnresolvedError for an unknown role with no default fallback', async () => {
    await expect(
      route({ matrix: {}, role: 'ghost', taskType: 'code', actorId: 'harbormaster' }),
    ).rejects.toThrow(RoutingUnresolvedError);
  });

  it('propagates RoutingUnresolvedError when the verifier role resolves but the maker role does not', async () => {
    const partialMatrix: ScopedRoleMatrix = {
      global: { challenger: { default: { model: 'a', fallbackChain: [] } } },
    };
    await expect(
      route({
        matrix: partialMatrix,
        role: 'challenger',
        taskType: 'code',
        actorId: 'harbormaster',
      }),
    ).rejects.toThrow(RoutingUnresolvedError);
  });
});
