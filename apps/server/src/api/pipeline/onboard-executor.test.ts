import { afterEach, describe, expect, it, vi } from 'vitest';
import { listEvents, openEventLog, type EventLog } from '@dokima/events';
import type { OnboardStepArtifact } from './onboard-types.js';
import { runOnboardExecution, specialistActorId } from './onboard-executor.js';
import type { RealOnboardDispatch } from './onboard-dispatch-port.js';

function fakeArtifact(role: string, stepId: string): OnboardStepArtifact {
  return {
    stepId,
    role,
    summary: `${role} summary`,
    findings: [],
    session: { exitCode: 0, scopeViolations: [] },
  };
}

describe('runOnboardExecution (W8-09 — real-dispatch bridge over runOnboard)', () => {
  let log: EventLog | undefined;

  afterEach(() => {
    log?.close();
    log = undefined;
  });

  it('dispatches every real step exactly once, threads real artifacts as priorArtifacts, and emits one onboard.step-complete event per step signed by that step’s own specialist identity', async () => {
    log = openEventLog(':memory:');
    const now = () => '2026-07-21T00:00:00.000Z';
    const calls: { role: string; stepId: string; priorArtifacts: unknown }[] = [];
    const dispatch: RealOnboardDispatch = vi.fn(async (role, context) => {
      calls.push({
        role,
        stepId: context.stepId,
        priorArtifacts: context.priorArtifacts,
      });
      return fakeArtifact(role, context.stepId);
    });

    const { result, stepArtifacts } = await runOnboardExecution(
      { seedContext: { repo: '/tmp/target' } },
      { log, runId: 'run-1', now, dispatch },
    );

    // 16 total steps (7 onboard + 8 security-cluster + 1 threat-model-refresh, W8-08).
    expect(calls).toHaveLength(16);
    expect(Object.keys(result.stepArtifacts)).toHaveLength(16);
    expect(Object.keys(stepArtifacts)).toHaveLength(16);

    const landscapeCall = calls.find((c) => c.stepId === 'landscape');
    const entryPointsCall = calls.find((c) => c.stepId === 'entry-points');
    expect(landscapeCall?.priorArtifacts).toEqual({});
    expect(entryPointsCall?.priorArtifacts).toEqual({
      landscape: fakeArtifact('landscape-mapper', 'landscape'),
    });

    const events = listEvents(log);
    const stepCompleteEvents = events.filter(
      (e) => e.eventType === 'onboard.step-complete',
    );
    expect(stepCompleteEvents).toHaveLength(16);
    const landscapeEvent = stepCompleteEvents.find(
      (e) => (e.payload as { stepId: string }).stepId === 'landscape',
    );
    expect(landscapeEvent?.actorId).toBe(specialistActorId('landscape-mapper'));
    expect((landscapeEvent?.payload as { session: unknown }).session).toEqual({
      exitCode: 0,
      scopeViolations: [],
    });
  });

  it('all-or-nothing: a real dispatch failure propagates, and no event is ever appended', async () => {
    log = openEventLog(':memory:');
    const now = () => '2026-07-21T00:00:00.000Z';
    const dispatch: RealOnboardDispatch = vi.fn(async (role, context) => {
      if (context.stepId === 'components') throw new Error('specialist session failed');
      return fakeArtifact(role, context.stepId);
    });

    await expect(
      runOnboardExecution({ seedContext: {} }, { log, runId: 'run-2', now, dispatch }),
    ).rejects.toThrow('specialist session failed');

    expect(listEvents(log)).toHaveLength(0);
  });
});

describe('the RALPH_WIGGUM coverage loop runs the preflight (W15-03, R-B5)', () => {
  let log: EventLog | undefined;
  afterEach(() => {
    log?.close();
    log = undefined;
  });

  function failingArtifact(role: string, stepId: string): OnboardStepArtifact {
    return {
      stepId,
      role,
      summary: 'session failed',
      findings: [],
      session: { exitCode: 1, scopeViolations: [] },
    };
  }

  it('RED FIXTURE: a step that fails once and succeeds on retry is re-dispatched and the run completes covered — the failure no longer flows through as if covered', async () => {
    log = openEventLog(':memory:');
    const now = () => '2026-08-20T00:00:00.000Z';
    let landscapeAttempts = 0;
    const dispatch: RealOnboardDispatch = async (role, context) => {
      if (context.stepId === 'landscape') {
        landscapeAttempts += 1;
        if (landscapeAttempts === 1) return failingArtifact(role, context.stepId);
      }
      return fakeArtifact(role, context.stepId);
    };

    const { stepArtifacts } = await runOnboardExecution(
      { seedContext: { repo: '/tmp/target' } },
      { log, runId: 'run-1', now, dispatch },
    );

    expect(landscapeAttempts).toBe(2);
    expect(stepArtifacts.landscape!.session.exitCode).toBe(0);

    const iterations = listEvents(log).filter((e) => e.eventType === 'coverage.iteration');
    expect(iterations.length).toBeGreaterThanOrEqual(2);
    const first = iterations[0]!.payload as { uncovered: string[] };
    expect(first.uncovered).toEqual(['landscape']);
  });

  it('RED FIXTURE: an ever-failing step halts EARLY on the byte-identical gap set (no-progress, before the cap of 3), and the halt is ledgered — no silent cap', async () => {
    log = openEventLog(':memory:');
    const now = () => '2026-08-20T00:00:00.000Z';
    let landscapeAttempts = 0;
    const dispatch: RealOnboardDispatch = async (role, context) => {
      if (context.stepId === 'landscape') {
        landscapeAttempts += 1;
        return failingArtifact(role, context.stepId);
      }
      return fakeArtifact(role, context.stepId);
    };

    const { stepArtifacts } = await runOnboardExecution(
      { seedContext: { repo: '/tmp/target' } },
      { log, runId: 'run-1', now, dispatch },
    );

    // Iteration 1 discovers all; iterations 2 and 3 both leave exactly
    // {landscape} uncovered — byte-identical, so the loop halts at 3
    // dispatches total for the step, never a fourth.
    expect(landscapeAttempts).toBeLessThanOrEqual(3);
    // The truth survives: the artifact carries its honest failing exit.
    expect(stepArtifacts.landscape!.session.exitCode).toBe(1);
    const iterations = listEvents(log!).filter(
      (e) => e.eventType === 'coverage.iteration',
    );
    expect(iterations.length).toBeGreaterThanOrEqual(2);
    const last = iterations.at(-1)!.payload as {
      uncovered: string[];
      gapChecksum: string | null;
    };
    expect(last.uncovered).toEqual(['landscape']);
    expect(last.gapChecksum).not.toBeNull();
  });
});
