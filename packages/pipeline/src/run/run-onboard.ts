/**
 * The onboard/analysis run executor (W8-08 AC1) — the W5-17 half of the
 * analog gap `run-pipeline.ts`'s own header describes for the creation
 * pipeline: `modes/onboard.ts` was static topology only ("a future wiring
 * ticket binds ONBOARD_STEPS to real specialist invocations"); this module
 * is that binder, minus the real gateway/HANDOFF call (W8-09's job).
 *
 * `runOnboard` iterates `ONBOARD_STEPS` (the four FR-P5 AC1 specialists)
 * followed by `SECURITY_STEPS` (`modes/security-cluster.ts` — the
 * security-cluster + threat-model-refresh topology this ticket adds
 * alongside onboard.ts, per the W8-01 dogfood-gate note), dispatching each
 * step's single producing role through `port.dispatch(role, context)` and
 * threading the returned artifact into an accumulating map keyed by step
 * id — later steps (e.g. `attack-chainer`, which reads the earlier
 * cluster findings) see every prior artifact, not just their immediate
 * predecessor's. `runOnboard` never inspects or authors artifact content
 * (Law 6): it only routes it.
 *
 * All-or-nothing (AC3, mirroring `runPipeline`): `port.dispatch` is called
 * directly inside the loop with no try/catch, so a thrown dispatch error
 * propagates immediately — the function never reaches its `return`, no
 * `OnboardRunResult` (partial or otherwise) is ever constructed, and no
 * `step-complete` event is emitted for the step that didn't finish (emit
 * only runs after a step's dispatch call already returned).
 */
import { buildOnboardCoverageManifest } from '../modes/coverage-manifest.js';
import { ONBOARD_STEPS } from '../modes/onboard.js';
import { SECURITY_STEPS } from '../modes/security-cluster.js';
import type { ModeStep } from '../modes/types.js';
import type { OnboardPort, OnboardRunResult, RunOnboardInput } from './types.js';

const ONBOARD_RUN_STEPS: readonly ModeStep[] = [...ONBOARD_STEPS, ...SECURITY_STEPS];

const HEALTH_STEP_ID = 'health';

export class MixedStepRoleError extends Error {
  constructor(stepId: string) {
    super(
      `onboard step "${stepId}" declares deliverables with more than one producing ` +
        'role — runOnboard dispatches one role per step and has no way to route a ' +
        'single artifact back to two specialists',
    );
    this.name = 'MixedStepRoleError';
  }
}

function stepRole(step: ModeStep): string {
  const roles = new Set(step.deliverables.map((d) => d.producingRole));
  if (roles.size !== 1) throw new MixedStepRoleError(step.id);
  return [...roles][0] as string;
}

/**
 * Runs the full onboard/analysis topology (onboard steps + security cluster
 * + threat-model refresh) in sequence, emitting one `OnboardRunEvent` per
 * completed step via `port.emit`, and returns the resulting
 * `OnboardRunResult` — the `health` step's artifact surfaced as
 * `healthAssessment`, every step's artifact keyed by step id, and the
 * (deterministic, constant) coverage manifest naming every imported
 * anti-slop rule and validator by name (AC2). Throws — no partial result,
 * no trailing event — if any step's `port.dispatch` call throws.
 */
export function runOnboard(input: RunOnboardInput, port: OnboardPort): OnboardRunResult {
  const stepArtifacts: Record<string, unknown> = {};

  for (const step of ONBOARD_RUN_STEPS) {
    const role = stepRole(step);
    const artifact = port.dispatch(role, {
      seedContext: input.seedContext,
      stepId: step.id,
      role,
      deliverables: step.deliverables,
      priorArtifacts: { ...stepArtifacts },
    });
    stepArtifacts[step.id] = artifact;
    port.emit({ kind: 'step-complete', stepId: step.id, role });
  }

  return {
    healthAssessment: stepArtifacts[HEALTH_STEP_ID],
    stepArtifacts,
    coverageManifest: buildOnboardCoverageManifest(),
  };
}
