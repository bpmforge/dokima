import { describe, expect, it, vi } from 'vitest';
import { ONBOARD_STEPS } from '../modes/onboard.js';
import { SECURITY_STEPS } from '../modes/security-cluster.js';
import { MixedStepRoleError, runOnboard } from './run-onboard.js';
import type { OnboardDispatchContext, OnboardPort, OnboardRunEvent } from './types.js';

const ALL_STEP_IDS = [...ONBOARD_STEPS, ...SECURITY_STEPS].map((s) => s.id);

function fakePort(
  overrides: {
    dispatch?: (role: string, context: OnboardDispatchContext) => unknown;
  } = {},
): { port: OnboardPort; events: OnboardRunEvent[]; calls: OnboardDispatchContext[] } {
  const events: OnboardRunEvent[] = [];
  const calls: OnboardDispatchContext[] = [];
  const dispatch =
    overrides.dispatch ??
    ((role: string, context: OnboardDispatchContext) =>
      `artifact:${role}:${context.stepId}`);
  const port: OnboardPort = {
    dispatch: (role, context) => {
      calls.push(context);
      return dispatch(role, context);
    },
    emit: (event) => events.push(event),
  };
  return { port, events, calls };
}

describe('runOnboard (W8-08 AC1/AC2/AC3)', () => {
  it('AC1: dispatches every onboard + security-cluster + threat-model-refresh step in order with a FAKE local port and no network', () => {
    const { port, events } = fakePort();
    const result = runOnboard({ seedContext: { repo: '/tmp/target' } }, port);

    expect(events.map((e) => e.stepId)).toEqual(ALL_STEP_IDS);
    expect(Object.keys(result.stepArtifacts)).toEqual(ALL_STEP_IDS);
    expect(result.healthAssessment).toBe('artifact:health-coordinator:health');
  });

  it('AC1: threads each prior step’s artifact into the next dispatch call’s context', () => {
    const { port, calls } = fakePort();
    runOnboard({ seedContext: {} }, port);

    const landscapeIndex = calls.findIndex((c) => c.stepId === 'landscape');
    const entryPointsIndex = calls.findIndex((c) => c.stepId === 'entry-points');
    expect(calls[landscapeIndex]?.priorArtifacts).toEqual({});
    expect(calls[entryPointsIndex]?.priorArtifacts).toEqual({
      landscape: 'artifact:landscape-mapper:landscape',
    });

    const attackChainsIndex = calls.findIndex(
      (c) => c.stepId === 'security-attack-chains',
    );
    expect(Object.keys(calls[attackChainsIndex]?.priorArtifacts ?? {})).toEqual(
      ALL_STEP_IDS.slice(0, attackChainsIndex),
    );
  });

  it('AC2: the coverage manifest names all 30 anti-slop rules and every imported validator', () => {
    const { port } = fakePort();
    const result = runOnboard({ seedContext: {} }, port);

    expect(result.coverageManifest.antiSlopRules).toHaveLength(30);
    expect(result.coverageManifest.validators.length).toBeGreaterThan(0);
    for (const rule of result.coverageManifest.antiSlopRules) {
      expect(['proposed', 'shadow', 'advisory', 'gate', 'deprecated']).toContain(
        rule.state,
      );
    }
  });

  it('AC3: a step dispatch error halts the run — no partial OnboardRunResult, no step-complete for the failed step', () => {
    const failingDispatch = vi.fn((role: string, context: OnboardDispatchContext) => {
      if (context.stepId === 'components') throw new Error('specialist dispatch failed');
      return `artifact:${role}:${context.stepId}`;
    });
    const { port, events } = fakePort({ dispatch: failingDispatch });

    expect(() => runOnboard({ seedContext: {} }, port)).toThrow(
      'specialist dispatch failed',
    );
    expect(events.map((e) => e.stepId)).toEqual([
      'landscape',
      'entry-points',
      'data-model',
    ]);
    expect(events.some((e) => e.stepId === 'components')).toBe(false);
  });

  it('AC3: no coverage manifest / health assessment is ever built from an incomplete run', () => {
    const { port } = fakePort({
      dispatch: () => {
        throw new Error('boom');
      },
    });
    let result: unknown;
    try {
      result = runOnboard({ seedContext: {} }, port);
    } catch {
      // expected
    }
    expect(result).toBeUndefined();
  });

  it('never authors artifact content itself — the artifact is exactly what dispatch returned', () => {
    const { port } = fakePort({
      dispatch: (role, context) => ({ role, stepId: context.stepId, marker: 'FAKE' }),
    });
    const result = runOnboard({ seedContext: {} }, port);
    expect(result.stepArtifacts.landscape).toEqual({
      role: 'landscape-mapper',
      stepId: 'landscape',
      marker: 'FAKE',
    });
  });

  it('MixedStepRoleError names the offending step', () => {
    const err = new MixedStepRoleError('fake-step');
    expect(err.name).toBe('MixedStepRoleError');
    expect(err.message).toContain('fake-step');
  });
});
