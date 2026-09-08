/**
 * The security half of onboard execution, run against the declared graph
 * (W23-07, AB-07).
 *
 * WHY THIS IS A SEPARATE MODULE. `runCheckSchedule` lives in
 * `@dokima/harbormaster` and knows nothing about models or routing, because a
 * package may not import an app. The security GRAPH lives in
 * `@dokima/pipeline`. Only `apps/server` may hold both, so this is the seam
 * where a generic scheduler and a specific topology meet — and keeping it here
 * rather than inline in `onboard-executor.ts` is also what keeps that file
 * under the chapter cap.
 *
 * THE TOOL NODES ARE ALREADY DONE. Stage A ran before any specialist was
 * dispatched (`onboard-run.ts` calls the registry first, W23-04), so their
 * `execute` returns the evidence already collected rather than running a
 * scanner a second time. They stay IN the graph on purpose: deleting a
 * completed node from a dependency graph is how a specialist ends up
 * "independent" of the tool whose output it reads.
 *
 * UNRESOLVED IS NOT SKIPPABLE. Only a documented NOT_APPLICABLE releases a
 * dependent. A category the runtime could not classify is required, so it runs
 * — which is the difference between "there is no cloud here" and "nobody
 * looked".
 */

import type { NodeApplicability } from '@dokima/pipeline';
import type { runCheckSchedule as RunCheckSchedule } from '@dokima/harbormaster';
import { SECURITY_PLAN, skippedCategories } from '@dokima/pipeline';
import type { RealOnboardDispatch } from './onboard-dispatch-port.js';
import type { OnboardStepArtifact } from './onboard-types.js';

interface DispatchableStep {
  readonly stepId: string;
  readonly role: string;
  readonly deliverables: Parameters<RealOnboardDispatch>[1]['deliverables'];
}

export interface DispatchSecurityGroupInput {
  readonly steps: readonly DispatchableStep[];
  readonly seedContext: Readonly<Record<string, unknown>>;
  /** The shared artifact cache the coverage loop reads afterwards. Written only from the scheduler's own completion callback. */
  readonly cache: Record<string, OnboardStepArtifact>;
  readonly dispatch: RealOnboardDispatch;
  readonly schedule: typeof RunCheckSchedule;
  readonly applicability: readonly NodeApplicability[];
  readonly workerLimit?: number;
}

/**
 * Two at a time by default. Not a guess about hardware: every specialist here
 * is a MODEL request, and model requests additionally queue behind the shared
 * endpoint limit (W23-06), so a larger number here buys queueing rather than
 * throughput on the local-first configuration this release targets.
 */
const DEFAULT_SECURITY_WORKERS = 2;

export async function dispatchSecurityGroup(
  input: DispatchSecurityGroupInput,
): Promise<void> {
  const stepById = new Map(input.steps.map((step) => [step.stepId, step]));
  if (stepById.size === 0) return;

  const notApplicable = new Set(
    input.applicability.filter((a) => a.status === 'not_applicable').map((a) => a.nodeId),
  );

  // Only the nodes this pass is actually asked to run, plus the tool nodes
  // they depend on — a graph containing a node with no step and no evidence
  // would block its dependents forever.
  const nodes = SECURITY_PLAN.filter(
    (node) => stepById.has(node.id) || node.kind === 'tool',
  ).map((node) => ({
    id: node.id,
    dependsOn: node.dependsOn.filter(
      (dep) =>
        stepById.has(dep) || SECURITY_PLAN.some((n) => n.id === dep && n.kind === 'tool'),
    ),
  }));

  await input.schedule<OnboardStepArtifact | null>({
    nodes,
    workerLimit: input.workerLimit ?? DEFAULT_SECURITY_WORKERS,
    sourceDigest: String(input.seedContext.repoRoot ?? ''),
    isSkippable: (nodeId) => notApplicable.has(nodeId),
    execute: async (node, predecessors) => {
      const step = stepById.get(node.id);
      // A tool node: stage A already ran it. Nothing to dispatch, and its
      // presence in the graph is what keeps its dependents ordered.
      if (!step) return null;

      /**
       * THE SYNTHESIS NODE IS TOLD WHAT WAS SKIPPED. Attack-chain synthesis
       * that does not know a category was skipped reads its absence as an
       * absence of findings — the difference between "no cloud
       * misconfiguration" and "nobody looked at the cloud" (AB-05 step 4).
       */
      const skipped = skippedCategories(input.applicability);
      const seedContext =
        node.id === 'security-attack-chains' && skipped.length > 0
          ? { ...input.seedContext, skippedSecurityCategories: skipped }
          : input.seedContext;

      const artifact = await input.dispatch(step.role, {
        stepId: step.stepId,
        seedContext,
        // The scheduler's own immutable snapshot, not the shared cache: a
        // node's inputs must not change under it while siblings are writing.
        priorArtifacts: Object.fromEntries(
          [...predecessors].filter(([, value]) => value !== null) as [
            string,
            OnboardStepArtifact,
          ][],
        ),
        deliverables: step.deliverables,
      });
      input.cache[step.stepId] = artifact;
      return artifact;
    },
  });
}
