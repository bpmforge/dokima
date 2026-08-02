/**
 * Bridges the real, async `RealOnboardDispatch` (`./onboard-dispatch-port.js`)
 * to the pure, synchronous `runOnboard` (`@dokima/pipeline`, W8-08) —
 * the exact "preflight (real gateway calls) -> pure replay" shape
 * `pipeline-routes/preflight.ts` uses for the creation pipeline, generalized
 * to a step list this package doesn't statically know (see below).
 *
 * `runOnboard`'s `OnboardDispatch` port type is deliberately synchronous
 * (`packages/pipeline/src/run/types.ts`: the package stays dependency-free,
 * every model-authored seam is an injected pure function), but a real
 * gateway call — and a real `runSession` — are both inherently async. So
 * this module never assigns the real dispatch directly as `runOnboard`'s
 * port; it drives the real work in front of the pure call, in two passes:
 *
 *   1. DISCOVERY: call the real `runOnboard` once with a no-op port that
 *      just records each step's (stepId, role, deliverables) as `dispatch`
 *      is invoked, in the exact order `run-onboard.ts`'s internal
 *      `ONBOARD_RUN_STEPS` topology produces (deterministic, W8-08's own
 *      `run-onboard.test.ts` AC1 asserts this order) — this ticket's
 *      write_scope has no `modes/index.js` re-export to import that step
 *      list from directly (`packages/pipeline/src/index.ts`'s barrel omits
 *      `modes/`/`phases/` entirely — a done-owned file this ticket must NOT
 *      self-widen into, per this repo's own W8-06 precedent), so recovering
 *      the topology by replaying `runOnboard` itself with a harmless no-op
 *      dispatch is the in-scope way to learn it.
 *   2. REAL PREFLIGHT: sequentially, in that discovered order, call the REAL
 *      `dispatch` (gateway + `runSession`), threading each step's real
 *      artifact into the next step's `priorArtifacts` — same threading
 *      `runOnboard` does internally, just done here so the async work can
 *      run before the final, synchronous, official call.
 *   3. FINAL: call the real `runOnboard` a second time, with a trivial
 *      synchronous port whose `dispatch` just looks up the already-computed
 *      real artifact by `stepId` (a replay, not a second divergent
 *      implementation — deterministic topology means the two `runOnboard`
 *      calls visit the exact same steps in the exact same order) and whose
 *      `emit` appends a real, hash-chained, plain AUDIT event per step (Law
 *      7) — never a receipt (see module-level note below on why not).
 *
 * If step 1 or 2 throws (a real dispatch failure), step 3 never runs: no
 * event is ever emitted and no `OnboardRunResult` is ever built — the same
 * all-or-nothing guarantee `runOnboard` itself provides for a single call
 * (W8-08 AC3), preserved across this two-call wrapper.
 *
 * SELF-ATTEST NOTE (Law 4/5, mirrors `pipeline-routes/events.ts`'s
 * SECURITY_W5 fix): `emit` here NEVER mints a `@dokima/events` receipt.
 * No independent validator ever runs on a specialist's own reported
 * findings, so minting a "gate"/"coverage" receipt for them would be the
 * exact self-attestation antipattern that fix removed from the creation
 * pipeline. Each step-complete event is signed by that STEP's OWN specialist
 * identity (`specialist:<role>`, a real `machine` identity minted here) —
 * never `OPERATOR_ACTOR_ID` — so the audit trail visibly attributes each
 * artifact to the specialist that produced it, distinct from the identity
 * that later accepts a finding onto the board (`onboard-board-lifecycle.ts`
 * always signs accept with `OPERATOR_ACTOR_ID`, never a specialist id —
 * AC3b, maker != verifier).
 */
import {
  appendEvent,
  createIdentity,
  getIdentity,
  type EventLog,
} from '@dokima/events';
import {
  runOnboard,
  type OnboardDispatchContext,
  type OnboardPort,
  type OnboardRunResult,
  type RunOnboardInput,
} from '@dokima/pipeline';
import type { RealOnboardDispatch } from './onboard-dispatch-port.js';
import type { OnboardStepArtifact } from './onboard-types.js';

type DeliverableList = OnboardDispatchContext['deliverables'];

interface DiscoveredStep {
  readonly stepId: string;
  readonly role: string;
  readonly deliverables: DeliverableList;
}

/** Pass 1 — see module header. Never performs real work: `dispatch` here
 * just records the call, so this is fast and network-free even before any
 * gateway config is resolved. */
function discoverSteps(input: RunOnboardInput): readonly DiscoveredStep[] {
  const steps: DiscoveredStep[] = [];
  const discoveryPort: OnboardPort = {
    dispatch: (role, context) => {
      steps.push({ stepId: context.stepId, role, deliverables: context.deliverables });
      return null;
    },
    emit: () => {
      /* discovery only — no durable effect */
    },
  };
  runOnboard(input, discoveryPort);
  return steps;
}

/** Pass 2 — see module header. Sequential (never `Promise.all`): each real
 * dispatch call's `priorArtifacts` must see only already-completed steps,
 * exactly like `runOnboard`'s own internal accumulation. */
async function runRealPreflight(
  input: RunOnboardInput,
  steps: readonly DiscoveredStep[],
  dispatch: RealOnboardDispatch,
): Promise<Record<string, OnboardStepArtifact>> {
  const cache: Record<string, OnboardStepArtifact> = {};
  for (const step of steps) {
    const artifact = await dispatch(step.role, {
      stepId: step.stepId,
      seedContext: input.seedContext,
      priorArtifacts: { ...cache },
      deliverables: step.deliverables,
    });
    cache[step.stepId] = artifact;
  }
  return cache;
}

export function specialistActorId(role: string): string {
  return `specialist:${role}`;
}

function ensureSpecialistIdentity(log: EventLog, role: string, now: () => string): void {
  const id = specialistActorId(role);
  if (getIdentity(log, id)) return;
  createIdentity(log, { id, name: role, kind: 'machine', role }, { now });
}

export interface OnboardExecutorDeps {
  readonly log: EventLog;
  readonly runId: string;
  readonly now: () => string;
  readonly dispatch: RealOnboardDispatch;
}

export interface OnboardExecutionResult {
  readonly result: OnboardRunResult;
  /** Every step's real artifact, same values as `result.stepArtifacts` but
   * typed — saves every caller re-casting `unknown`. */
  readonly stepArtifacts: Readonly<Record<string, OnboardStepArtifact>>;
}

/** Runs the full 3-pass real onboard execution (module header) and returns
 * the official `OnboardRunResult` alongside the typed artifact cache. */
export async function runOnboardExecution(
  input: RunOnboardInput,
  deps: OnboardExecutorDeps,
): Promise<OnboardExecutionResult> {
  const steps = discoverSteps(input);
  const cache = await runRealPreflight(input, steps, deps.dispatch);

  for (const step of steps) {
    ensureSpecialistIdentity(deps.log, step.role, deps.now);
  }

  const port: OnboardPort = {
    dispatch: (_role, context) => {
      const cached = cache[context.stepId];
      if (!cached) {
        throw new Error(
          `no real artifact cached for onboard step "${context.stepId}" — discovery/final topology mismatch`,
        );
      }
      return cached;
    },
    emit: (event) => {
      // Real per-step session evidence (exit code + observed write-scope
      // violations from the `runSession` call already made in the real
      // preflight pass) rides along on the same audit event as "the run's
      // receipts" (ticket AC2) — never a minted `@dokima/events`
      // receipt (see module header SELF-ATTEST NOTE).
      const artifact = cache[event.stepId];
      appendEvent(
        deps.log,
        {
          eventType: `onboard.${event.kind}`,
          actorId: specialistActorId(event.role),
          runId: deps.runId,
          payload: { ...event, session: artifact?.session ?? null },
        },
        { now: deps.now },
      );
    },
  };

  const result = runOnboard(input, port);
  return { result, stepArtifacts: cache };
}
