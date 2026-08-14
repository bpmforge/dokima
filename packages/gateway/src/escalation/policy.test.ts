import { describe, expect, it } from 'vitest';
import {
  guardMakerVerifierDistinct,
  SameModelRefusedError,
} from '../routing/maker-verifier.js';
import type { ScopedRoleMatrix } from '../routing/types.js';
import { createInMemoryEscalationEventSink } from './events.js';
import { MissingFailureEvidenceError } from './ladder.js';
import type { AttemptRunner } from './ladder.js';
import type { FailureReceipt, GateOutcome, Rung } from './types.js';
import {
  resolveEscalationPolicy,
  runEscalationPolicy,
  type EscalationPolicyInput,
  type ScopedEscalationPolicy,
} from './policy.js';
import type { EscalationToken, EscalationTokenHook } from './policy-types.js';

const matrix: ScopedRoleMatrix = {
  global: {
    'coding-agent': {
      default: {
        model: 'qwen2.5-coder-7b-instruct',
        fallbackChain: ['qwen2.5-coder-32b-instruct'],
      },
    },
    challenger: {
      default: { model: 'claude-opus-4-8', fallbackChain: [] },
    },
  },
};

const receipt = (name = 'gate'): FailureReceipt => ({
  name,
  exitCode: 1,
  gapCount: 1,
  gaps: [`${name} gap`],
});

/** Fails every rung up to (not including) `passAt`; `passAt: undefined` always fails, driving the terminal R4/ceiling path. */
function scriptedAttemptRunner(passAt: Rung | undefined): AttemptRunner {
  return ({ rung }) => {
    const outcome: GateOutcome =
      rung === passAt
        ? { passed: true, receipts: [] }
        : { passed: false, receipts: [receipt(rung)] };
    return outcome;
  };
}

function baseInput(
  overrides: Partial<EscalationPolicyInput> = {},
): EscalationPolicyInput {
  return {
    ticketId: 't-1',
    criterion: 'the thing works',
    actorId: 'harbormaster',
    matrix,
    policyScope: {},
    runAttempt: scriptedAttemptRunner(undefined),
    ...overrides,
  };
}

describe('resolveEscalationPolicy (D-018: three-scope, per role)', () => {
  it('defaults to ladder when nothing is configured for the role', () => {
    expect(resolveEscalationPolicy({}, 'coding-agent')).toEqual({ mode: 'ladder' });
  });

  it('run scope wins over project and global for the same role', () => {
    const scope: ScopedEscalationPolicy = {
      global: { 'coding-agent': { mode: 'ladder' } },
      project: {
        'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'metered' },
      },
      run: { 'coding-agent': { mode: 'token-gated', namedTier: 'R2' } },
    };
    expect(resolveEscalationPolicy(scope, 'coding-agent')).toEqual({
      mode: 'token-gated',
      namedTier: 'R2',
    });
  });

  it('is per-role: an unconfigured role falls back to ladder even when another role is locked', () => {
    const scope: ScopedEscalationPolicy = {
      global: {
        'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'metered' },
      },
    };
    expect(resolveEscalationPolicy(scope, 'challenger')).toEqual({ mode: 'ladder' });
  });
});

describe('runEscalationPolicy: ladder mode', () => {
  it('delegates to the unchanged R0-R4 ladder engine', async () => {
    const sink = createInMemoryEscalationEventSink();
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: { global: { 'coding-agent': { mode: 'ladder' } } },
        runAttempt: scriptedAttemptRunner('R2'),
        sink,
      }),
    );
    expect(outcome.mode).toBe('ladder');
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R2');
    expect(outcome.model).toBe('qwen2.5-coder-32b-instruct');
    expect(outcome.events).toHaveLength(1);
    expect(sink.events).toHaveLength(1);
  });

  it('is the default mode when policyScope resolves nothing for the role', async () => {
    const outcome = await runEscalationPolicy(
      baseInput({ policyScope: {}, runAttempt: scriptedAttemptRunner('R1') }),
    );
    expect(outcome.mode).toBe('ladder');
    expect(outcome.status).toBe('resolved');
  });
});

describe('runEscalationPolicy: locked mode (D-018, FR-L7)', () => {
  function lockedScope(pinnedTier: 'R1' | 'R2' | 'R3', tierKind: 'metered' | 'local') {
    return {
      global: { 'coding-agent': { mode: 'locked' as const, pinnedTier, tierKind } },
    };
  }

  it('resolves at the pinned tier without ever climbing, zero escalation events', async () => {
    let calls = 0;
    const sink = createInMemoryEscalationEventSink();
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: lockedScope('R2', 'metered'),
        runAttempt: ({ rung, modelChain }) => {
          calls += 1;
          expect(rung).toBe('R2');
          expect(modelChain).toEqual(['qwen2.5-coder-32b-instruct']);
          return calls < 3
            ? { passed: false, receipts: [receipt('R2')] }
            : { passed: true, receipts: [] };
        },
        sink,
      }),
    );
    expect(outcome.mode).toBe('locked');
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R2');
    expect(outcome.model).toBe('qwen2.5-coder-32b-instruct');
    expect(outcome.attempts.map((a) => a.rung)).toEqual(['R2', 'R2', 'R2']);
    expect(outcome.events).toHaveLength(0);
    expect(sink.events).toHaveLength(0);
  });

  it('metered tier loops to the ceiling of 8 attempts then PARKS blocked-with-evidence, zero escalation events', async () => {
    let calls = 0;
    const sink = createInMemoryEscalationEventSink();
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: lockedScope('R1', 'metered'),
        runAttempt: () => {
          calls += 1;
          return { passed: false, receipts: [receipt('R1')] };
        },
        sink,
      }),
    );
    expect(calls).toBe(8);
    expect(outcome.mode).toBe('locked');
    expect(outcome.status).toBe('blocked');
    expect(outcome.finalRung).toBe('R1');
    expect(outcome.parkedReason).toBe('locked_ceiling_reached');
    expect(outcome.attempts).toHaveLength(8);
    expect(outcome.attempts.every((a) => a.rung === 'R1')).toBe(true);
    expect(outcome.events).toHaveLength(0);
    expect(sink.events).toHaveLength(0);
  });

  it('local/owned-hardware tier gets the larger ceiling of 12 attempts (tier-aware)', async () => {
    let calls = 0;
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: lockedScope('R1', 'local'),
        runAttempt: () => {
          calls += 1;
          return { passed: false, receipts: [receipt('R1')] };
        },
      }),
    );
    expect(calls).toBe(12);
    expect(outcome.status).toBe('blocked');
    expect(outcome.attempts).toHaveLength(12);
  });

  it('refuses a failure reported with no receipts, same as ladder mode (FR-G3 unaffected by policy)', async () => {
    await expect(
      runEscalationPolicy(
        baseInput({
          policyScope: lockedScope('R1', 'metered'),
          runAttempt: () => ({ passed: false, receipts: [] }),
        }),
      ),
    ).rejects.toThrow(MissingFailureEvidenceError);
  });
});

describe('runEscalationPolicy: token-gated mode (D-018, FR-N2)', () => {
  function tokenGatedScope(namedTier: 'R1' | 'R2' | 'R3') {
    return { global: { 'coding-agent': { mode: 'token-gated' as const, namedTier } } };
  }

  it('climbs normally below the named tier, exactly like ladder', async () => {
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: tokenGatedScope('R3'),
        runAttempt: scriptedAttemptRunner('R2'),
      }),
    );
    expect(outcome.mode).toBe('token-gated');
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R2');
  });

  it('parks at the named tier boundary when no token is available — never auto-escalates', async () => {
    const sink = createInMemoryEscalationEventSink();
    let r3Attempted = false;
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: tokenGatedScope('R2'),
        runAttempt: ({ rung }) => {
          if (rung === 'R3') r3Attempted = true;
          return { passed: false, receipts: [receipt(rung)] };
        },
        sink,
      }),
    );
    expect(r3Attempted).toBe(false);
    expect(outcome.status).toBe('blocked');
    expect(outcome.finalRung).toBe('R2');
    expect(outcome.parkedReason).toBe('awaiting_escalation_token');
    // R1->R2 climbed freely (below the boundary); no event for the blocked R2->R3 crossing.
    expect(outcome.events.map((e) => `${e.fromRung}->${e.toRung}`)).toEqual(['R1->R2']);
    expect(sink.events).toHaveLength(1);
  });

  it('climbs exactly one rung past the boundary once an approval mints a token, then resumes normal climbing', async () => {
    const grantedToken: EscalationToken = {
      riskClass: 'escalation',
      ticketId: 't-1',
      boundary: 'R2',
      grantedBy: 'user:founder',
      grantedAt: '2026-07-15T00:00:00.000Z',
    };
    const tokenHook: EscalationTokenHook = {
      checkToken: (req) => (req.boundary === 'R2' ? grantedToken : undefined),
    };
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: tokenGatedScope('R2'),
        runAttempt: scriptedAttemptRunner('R3'),
        tokenHook,
      }),
    );
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R3');
    expect(outcome.model).toBe('claude-opus-4-8');
    expect(outcome.events.map((e) => `${e.fromRung}->${e.toRung}`)).toEqual([
      'R1->R2',
      'R2->R3',
    ]);
  });

  it('resumes a parked run from priorAttempts instead of re-attempting already-failed rungs', async () => {
    const parked = await runEscalationPolicy(
      baseInput({
        policyScope: tokenGatedScope('R1'),
        runAttempt: () => ({ passed: false, receipts: [receipt('R1')] }),
      }),
    );
    expect(parked.status).toBe('blocked');
    expect(parked.finalRung).toBe('R1');

    const grantedToken: EscalationToken = {
      riskClass: 'escalation',
      ticketId: 't-1',
      boundary: 'R1',
      grantedBy: 'user:founder',
      grantedAt: '2026-07-15T00:00:00.000Z',
    };
    let r1ReAttempted = false;
    const resumed = await runEscalationPolicy(
      baseInput({
        policyScope: tokenGatedScope('R1'),
        runAttempt: ({ rung }) => {
          if (rung === 'R1') r1ReAttempted = true;
          return { passed: true, receipts: [] };
        },
        tokenHook: { checkToken: () => grantedToken },
        resume: {
          priorAttempts: parked.attempts,
          lastFailure: { rung: 'R1', receipts: [receipt('R1')] },
        },
      }),
    );
    expect(r1ReAttempted).toBe(false);
    expect(resumed.status).toBe('resolved');
    expect(resumed.finalRung).toBe('R2');
  });

  it('reaching R4 past the named tier is a normal terminal park (not an awaiting_escalation_token park)', async () => {
    const grantedToken: EscalationToken = {
      riskClass: 'escalation',
      ticketId: 't-1',
      boundary: 'R2',
      grantedBy: 'user:founder',
      grantedAt: '2026-07-15T00:00:00.000Z',
    };
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: tokenGatedScope('R2'),
        runAttempt: scriptedAttemptRunner(undefined),
        tokenHook: { checkToken: () => grantedToken },
      }),
    );
    expect(outcome.status).toBe('blocked');
    expect(outcome.finalRung).toBe('R4');
    expect(outcome.parkedReason).toBeUndefined();
    expect(outcome.events.at(-1)?.type).toBe('escalation.blocked');
  });

  it('refuses a failure reported with no receipts, same as ladder mode (FR-G3 unaffected by policy)', async () => {
    await expect(
      runEscalationPolicy(
        baseInput({
          policyScope: tokenGatedScope('R2'),
          runAttempt: () => ({ passed: false, receipts: [] }),
        }),
      ),
    ).rejects.toThrow(MissingFailureEvidenceError);
  });
});

describe('property: gates, maker!=verifier, and NEVER-AUTO hold across all three policy modes', () => {
  const modeScopes: Array<{ label: string; scope: ScopedEscalationPolicy }> = [
    { label: 'ladder', scope: { global: { 'coding-agent': { mode: 'ladder' } } } },
    {
      label: 'locked',
      scope: {
        global: {
          'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'metered' },
        },
      },
    },
    {
      label: 'token-gated',
      scope: {
        global: { 'coding-agent': { mode: 'token-gated', namedTier: 'R1' } },
      },
    },
  ];

  it.each(modeScopes)(
    'deterministic gates: a failure reported without receipts is refused identically under $label',
    async ({ scope }) => {
      await expect(
        runEscalationPolicy(
          baseInput({
            policyScope: scope,
            runAttempt: () => ({ passed: false, receipts: [] }),
          }),
        ),
      ).rejects.toThrow(MissingFailureEvidenceError);
    },
  );

  it.each(modeScopes)(
    'deterministic gates: an identical scripted attempt history produces an identical outcome under $label (no hidden randomness)',
    async ({ scope }) => {
      const run = () =>
        runEscalationPolicy(
          baseInput({ policyScope: scope, runAttempt: scriptedAttemptRunner(undefined) }),
        );
      const [a, b] = await Promise.all([run(), run()]);
      expect(a.status).toBe(b.status);
      expect(a.finalRung).toBe(b.finalRung);
      expect(a.attempts.map((x) => x.rung)).toEqual(b.attempts.map((x) => x.rung));
    },
  );

  it.each(modeScopes)(
    'maker!=verifier (FR-G2) is untouched by running policy mode $label: the routing guard still refuses a same-model collision',
    async ({ scope }) => {
      // Run the policy engine first so any shared/global state it might touch is exercised...
      await runEscalationPolicy(
        baseInput({ policyScope: scope, runAttempt: scriptedAttemptRunner('R1') }),
      ).catch(() => undefined);
      // ...then assert routing's independent guard behaves exactly as it would with no policy involved.
      await expect(
        guardMakerVerifierDistinct({
          verifierRole: 'challenger',
          makerRole: 'coding-agent',
          taskType: 'code',
          verifierModel: 'same-model',
          makerModel: 'same-model',
          actorId: 'harbormaster',
        }),
      ).rejects.toThrow(SameModelRefusedError);
    },
  );

  it('NEVER-AUTO: token-gated mode can never cross a named-tier boundary without an actual token, across many random gate-failure histories', async () => {
    for (const namedTier of ['R1', 'R2', 'R3'] as const) {
      const scope: ScopedEscalationPolicy = {
        global: { 'coding-agent': { mode: 'token-gated', namedTier } },
      };
      for (const passAt of ['R1', 'R2', 'R3', undefined] as const) {
        const outcome = await runEscalationPolicy(
          baseInput({
            ticketId: `t-${namedTier}-${passAt}`,
            policyScope: scope,
            runAttempt: scriptedAttemptRunner(passAt),
            tokenHook: { checkToken: () => undefined }, // never mints — the honest default
          }),
        );
        const crossedBoundary = outcome.attempts.some(
          (a) => RUNG_INDEX(a.rung) > RUNG_INDEX(namedTier),
        );
        if (crossedBoundary) {
          throw new Error(
            `mode token-gated(${namedTier}) crossed its boundary with no token present (passAt=${passAt})`,
          );
        }
      }
    }
  });

  it('NEVER-AUTO: locked mode never emits an escalation event regardless of pass/fail pattern', async () => {
    for (const passAt of ['R1', undefined] as const) {
      const sink = createInMemoryEscalationEventSink();
      await runEscalationPolicy(
        baseInput({
          policyScope: {
            global: {
              'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'metered' },
            },
          },
          runAttempt: scriptedAttemptRunner(passAt),
          sink,
        }),
      );
      expect(sink.events).toHaveLength(0);
    }
  });
});

function RUNG_INDEX(rung: Rung): number {
  return ['R0', 'R1', 'R2', 'R3', 'R4'].indexOf(rung);
}

describe('runEscalationPolicy: pinned mode (W12-12, D-024 option b)', () => {
  const pinnedScope = (model: string, extra: Record<string, unknown> = {}) => ({
    global: {
      'coding-agent': { mode: 'pinned' as const, model, tierKind: 'metered' as const },
      ...extra,
    },
  });

  it(
    'RED FIXTURE: runs the NAMED MODEL and never substitutes. `locked` pins a ' +
      'ladder RUNG and resolves the model through the matrix, so it can run a ' +
      'different model as the matrix changes; pinning names the model itself',
    async () => {
      const seen: string[][] = [];
      const outcome = await runEscalationPolicy(
        baseInput({
          policyScope: pinnedScope('gpt-5'),
          runAttempt: ({ modelChain }) => {
            seen.push([...modelChain]);
            return Promise.resolve({ passed: true, receipts: [] });
          },
        }),
      );
      expect(outcome.mode).toBe('pinned');
      expect(outcome.status).toBe('resolved');
      expect(outcome.model).toBe('gpt-5');
      // Exactly one model was ever offered, and it is the pinned one — no
      // fallback chain, no matrix-resolved neighbour.
      expect(seen).toEqual([['gpt-5']]);
    },
  );

  it(
    'PARKS when the pinned model is exhausted rather than escalating — a silent ' +
      'climb to a stronger model is precisely what pinning promises will not happen',
    async () => {
      const offered: string[] = [];
      const outcome = await runEscalationPolicy(
        baseInput({
          policyScope: pinnedScope('gpt-5'),
          runAttempt: ({ modelChain }) => {
            offered.push(modelChain[0]!);
            return Promise.resolve({
              passed: false,
              receipts: [{ name: 'test', exitCode: 1, gapCount: 1 }],
            });
          },
        }),
      );
      expect(outcome.status).toBe('blocked');
      expect(outcome.parkedReason).toBe('pinned_model_exhausted');
      // Every attempt used the pinned model; nothing else was ever tried.
      expect(new Set(offered)).toEqual(new Set(['gpt-5']));
      expect(outcome.events).toEqual([]);
    },
  );

  it(
    'C-4 RED FIXTURE: pinning ONE model for maker AND verifier is refused by name. ' +
      'A convenience setting does not get to dissolve a hard constraint — maker and ' +
      'verifier are distinct by construction (CLAUDE.md law 5)',
    async () => {
      await expect(
        runEscalationPolicy(
          baseInput({
            policyScope: pinnedScope('gpt-5', {
              challenger: { mode: 'pinned' as const, model: 'gpt-5', tierKind: 'metered' as const },
            }),
            runAttempt: () => Promise.resolve({ passed: true, receipts: [] }),
          }),
        ),
      ).rejects.toThrowError(/C-4 requires maker and verifier to differ/);
    },
  );

  it('a DIFFERENT verifier pin is allowed — the constraint is distinctness, not a ban on pinning', async () => {
    const outcome = await runEscalationPolicy(
      baseInput({
        policyScope: pinnedScope('gpt-5', {
          challenger: {
            mode: 'pinned' as const,
            model: 'claude-opus-4-5',
            tierKind: 'metered' as const,
          },
        }),
        runAttempt: () => Promise.resolve({ passed: true, receipts: [] }),
      }),
    );
    expect(outcome.status).toBe('resolved');
    expect(outcome.model).toBe('gpt-5');
  });

  it('resolves through the SAME three-scope per-role path D-018 already built', () => {
    const scope: ScopedEscalationPolicy = {
      global: { 'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'metered' } },
      run: { 'coding-agent': { mode: 'pinned', model: 'gpt-5', tierKind: 'metered' } },
    };
    expect(resolveEscalationPolicy(scope, 'coding-agent')).toEqual({
      mode: 'pinned',
      model: 'gpt-5',
      tierKind: 'metered',
    });
    // An unconfigured role still falls back to ladder, unchanged.
    expect(resolveEscalationPolicy(scope, 'challenger')).toEqual({ mode: 'ladder' });
  });
});
