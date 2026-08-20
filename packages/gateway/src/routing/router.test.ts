import { describe, expect, it } from 'vitest';
import { UnfitAssignmentRefusedError } from '../fitness/assignment.js';
import { createInMemoryFitnessEventSink } from '../fitness/events.js';
import { FitnessCardStore } from '../fitness/store.js';
import type { FitnessCard } from '../fitness/types.js';
import {
  createInMemoryRoutingEventSink,
  SameModelRefusedError,
} from './maker-verifier.js';
import { RoutingUnresolvedError } from './matrix.js';
import { buildPresetMatrix, PRESET_SHAPES } from './presets.js';
import { route } from './router.js';
import type { ScopedRoleMatrix } from './types.js';

// W13-36: built from picks rather than a shipped literal — a preset no
// longer names a model.
const matrix: ScopedRoleMatrix = {
  global: buildPresetMatrix(PRESET_SHAPES.hybrid, {
    strong: 'users-strong-model',
    cheap: 'users-cheap-model',
  }),
};

function noBenchStore(): FitnessCardStore {
  return new FitnessCardStore();
}

function card(overrides: Partial<FitnessCard> = {}): FitnessCard {
  return {
    model: 'users-cheap-model',
    role: 'coding-agent',
    verdict: 'unfit',
    harnessVersion: '1.0.0',
    taskResults: [],
    runAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('route', () => {
  it('resolves task routing alone for a non-verifier role, no maker context needed', async () => {
    const result = await route({
      matrix,
      role: 'coding-agent',
      taskType: 'code',
      actorId: 'harbormaster',
      fitnessStore: noBenchStore(),
    });
    expect(result.chain[0]).toBe('users-cheap-model');
    expect(result.overrideEvent).toBeUndefined();
  });

  it('resolves a verifier role that legitimately differs from the maker (the Hybrid preset default) with zero extra params', async () => {
    const reviewer = await route({
      matrix,
      role: 'code-reviewer',
      taskType: 'code',
      actorId: 'harbormaster',
      fitnessStore: noBenchStore(),
    });
    expect(reviewer.chain[0]).toBe('users-strong-model');
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
          fitnessStore: noBenchStore(),
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
      fitnessStore: noBenchStore(),
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
        fitnessStore: noBenchStore(),
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
      fitnessStore: noBenchStore(),
    });
    expect(result.chain[0]).toBe('shared-model');
    expect(result.overrideEvent).toBeUndefined();
  });

  it('propagates RoutingUnresolvedError for an unknown role with no default fallback', async () => {
    await expect(
      route({
        matrix: {},
        role: 'ghost',
        taskType: 'code',
        actorId: 'harbormaster',
        fitnessStore: noBenchStore(),
      }),
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
        fitnessStore: noBenchStore(),
      }),
    ).rejects.toThrow(RoutingUnresolvedError);
  });

  describe('fitness guard (FR-G6)', () => {
    it('the fitness guard is structural: unfit is refused even though the caller only supplied a store, no ack', async () => {
      const store = noBenchStore();
      store.put(
        card({
          model: 'users-cheap-model',
          role: 'coding-agent',
          verdict: 'unfit',
        }),
      );
      await expect(
        route({
          matrix,
          role: 'coding-agent',
          taskType: 'code',
          actorId: 'harbormaster',
          fitnessStore: store,
        }),
      ).rejects.toThrow(UnfitAssignmentRefusedError);
    });

    it('a marginal verdict is refused the same as unfit', async () => {
      const store = noBenchStore();
      store.put(
        card({
          model: 'users-cheap-model',
          role: 'coding-agent',
          verdict: 'marginal',
        }),
      );
      await expect(
        route({
          matrix,
          role: 'coding-agent',
          taskType: 'code',
          actorId: 'harbormaster',
          fitnessStore: store,
        }),
      ).rejects.toThrow(UnfitAssignmentRefusedError);
    });

    it('an explicit ack proceeds past an unfit verdict and emits fitness.unfit_ack via the sink', async () => {
      const store = noBenchStore();
      store.put(
        card({
          model: 'users-cheap-model',
          role: 'coding-agent',
          verdict: 'unfit',
        }),
      );
      const sink = createInMemoryFitnessEventSink();
      const result = await route({
        matrix,
        role: 'coding-agent',
        taskType: 'code',
        actorId: 'user:founder',
        fitnessStore: store,
        fitnessAck: true,
        fitnessSink: sink,
      });
      expect(result.chain[0]).toBe('users-cheap-model');
      expect(result.fitnessAckEvent?.verdict).toBe('unfit');
      expect(sink.events).toHaveLength(1);
    });

    it('a fit verdict passes through with the card surfaced, no ack needed', async () => {
      const store = noBenchStore();
      store.put(
        card({
          model: 'users-cheap-model',
          role: 'coding-agent',
          verdict: 'fit',
        }),
      );
      const result = await route({
        matrix,
        role: 'coding-agent',
        taskType: 'code',
        actorId: 'harbormaster',
        fitnessStore: store,
      });
      expect(result.fitnessCard?.verdict).toBe('fit');
      expect(result.fitnessAckEvent).toBeUndefined();
    });

    it('an unbenched (model, role) passes through silently — never benching is not itself unfit', async () => {
      const result = await route({
        matrix,
        role: 'coding-agent',
        taskType: 'code',
        actorId: 'harbormaster',
        fitnessStore: noBenchStore(),
      });
      expect(result.fitnessCard).toBeUndefined();
    });

    it('a custom harnessVersion is respected — a card for a different version does not match', async () => {
      const store = noBenchStore();
      store.put(
        card({
          model: 'users-cheap-model',
          role: 'coding-agent',
          verdict: 'unfit',
          harnessVersion: '0.9.0',
        }),
      );
      const result = await route({
        matrix,
        role: 'coding-agent',
        taskType: 'code',
        actorId: 'harbormaster',
        fitnessStore: store,
        harnessVersion: '1.0.0',
      });
      expect(result.fitnessCard).toBeUndefined();
    });
  });
});
