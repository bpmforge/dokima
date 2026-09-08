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

    const iterations = listEvents(log).filter(
      (e) => e.eventType === 'coverage.iteration',
    );
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

describe('W23-07: the security portion runs against the declared graph', () => {
  let log: EventLog | undefined;
  afterEach(() => {
    log?.close();
    log = undefined;
  });

  it('RED FIXTURE: synthesis is dispatched only after EVERY stage-B specialist has finished', async () => {
    log = openEventLog(':memory:');
    const finished: string[] = [];
    const startedWhenChainsBegan: string[] = [];

    const dispatch: RealOnboardDispatch = async (role, context) => {
      if (context.stepId === 'security-attack-chains')
        startedWhenChainsBegan.push(...finished);
      // Yield, so a scheduler that started synthesis early would be observed
      // doing it rather than accidentally serialized by synchronous returns.
      await new Promise((resolve) => setImmediate(resolve));
      finished.push(context.stepId);
      return fakeArtifact(role, context.stepId);
    };

    await runOnboardExecution(
      { seedContext: { repoRoot: '/tmp/target' } },
      { log, runId: 'run-graph', now: () => '2026-09-08T00:00:00.000Z', dispatch },
    );

    const stageB = [
      'security-sast',
      'security-secrets',
      'security-deps',
      'security-owasp-web',
      'security-owasp-llm',
      'security-cloud',
      'security-iac',
    ];
    for (const id of stageB) expect(startedWhenChainsBegan).toContain(id);
    // And the refresh is last of all.
    expect(finished.at(-1)).toBe('threat-model-refresh');
  });

  it('the seven GENERAL onboarding steps still run sequentially, before any security step', async () => {
    log = openEventLog(':memory:');
    const order: string[] = [];
    const dispatch: RealOnboardDispatch = async (role, context) => {
      order.push(context.stepId);
      await new Promise((resolve) => setImmediate(resolve));
      return fakeArtifact(role, context.stepId);
    };

    await runOnboardExecution(
      { seedContext: { repoRoot: '/tmp/target' } },
      { log, runId: 'run-seq', now: () => '2026-09-08T00:00:00.000Z', dispatch },
    );

    const firstSecurity = order.findIndex((id) => id.startsWith('security-'));
    const generalSteps = order.slice(0, firstSecurity);
    expect(generalSteps.length).toBeGreaterThanOrEqual(7);
    for (const id of generalSteps) expect(id.startsWith('security-')).toBe(false);
  });
});

describe('W23-08: a retry invalidates what read the old result', () => {
  let log: EventLog | undefined;
  afterEach(() => {
    log?.close();
    log = undefined;
  });

  it('RED FIXTURE: a security specialist that fails once and then succeeds re-runs the synthesis AND the refresh that read it', async () => {
    log = openEventLog(':memory:');
    const dispatches: string[] = [];
    let sastAttempts = 0;

    const dispatch: RealOnboardDispatch = async (role, context) => {
      dispatches.push(context.stepId);
      if (context.stepId === 'security-sast') {
        sastAttempts += 1;
        if (sastAttempts === 1) {
          return {
            ...fakeArtifact(role, context.stepId),
            session: { exitCode: 1, scopeViolations: [] },
          };
        }
      }
      return fakeArtifact(role, context.stepId);
    };

    await runOnboardExecution(
      { seedContext: { repoRoot: '/tmp/target' } },
      { log, runId: 'run-invalidate', now: () => '2026-09-08T00:00:00.000Z', dispatch },
    );

    const count = (id: string): number => dispatches.filter((d) => d === id).length;
    // The failing step was retried...
    expect(count('security-sast')).toBeGreaterThanOrEqual(2);
    // ...and so was everything downstream of it, transitively. Without
    // invalidation the synthesis stays cached and goes on citing findings from
    // the attempt that failed.
    expect(count('security-attack-chains')).toBeGreaterThanOrEqual(2);
    expect(count('threat-model-refresh')).toBeGreaterThanOrEqual(2);
  });

  it('independent security work is not repeated by another node’s retry', async () => {
    log = openEventLog(':memory:');
    const dispatches: string[] = [];
    let sastAttempts = 0;
    const dispatch: RealOnboardDispatch = async (role, context) => {
      dispatches.push(context.stepId);
      if (context.stepId === 'security-sast') {
        sastAttempts += 1;
        if (sastAttempts === 1) {
          return {
            ...fakeArtifact(role, context.stepId),
            session: { exitCode: 1, scopeViolations: [] },
          };
        }
      }
      return fakeArtifact(role, context.stepId);
    };

    await runOnboardExecution(
      { seedContext: { repoRoot: '/tmp/target' } },
      { log, runId: 'run-independent', now: () => '2026-09-08T00:00:00.000Z', dispatch },
    );

    // security-secrets reads tool-secrets, not tool-sast. Nothing about the
    // SAST retry touches it.
    expect(dispatches.filter((d) => d === 'security-secrets')).toHaveLength(1);
  });
});
