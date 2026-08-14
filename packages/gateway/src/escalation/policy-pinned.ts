/**
 * escalation/policy-pinned.ts — the `pinned` mode (D-024 option b, W12-12).
 *
 * Chapter of policy.ts, split under the 400-line CODE_BOOK_PROTOCOL cap.
 * Extracted the moment it pushed policy.ts to 461 lines: the cap is on the
 * FILE, not the diff, precisely because several individually-reasonable
 * appends accrete into a monolith and no single one looks wrong.
 *
 * Deliberately does NOT import policy.ts. The C-4 guard has to resolve other
 * roles' policies, so the resolver arrives as a parameter — importing it back
 * would make the two modules mutually dependent, which `validate-circular-deps`
 * gates against.
 */
import { VERIFIER_ROLES } from '../routing/types.js';
import type { AgentRole, TaskType } from '../routing/types.js';
import type { AttemptRunner, RungAttemptRecord } from './ladder.js';
import type { FailureReceipt, Rung } from './types.js';
import {
  CONVERGENCE_CEILING,
  PinnedPolicyMakerVerifierError,
  type EscalationPolicy,
  type PinnedModelPolicy,
  type ScopedEscalationPolicy,
} from './policy-types.js';

/** Exactly what the pinned mode needs — a narrow projection, not policy.ts's full input. */
export interface PinnedRunInput {
  readonly ticketId: string;
  readonly policyScope: ScopedEscalationPolicy;
  readonly runAttempt: AttemptRunner;
  readonly taskType?: TaskType;
}

export interface PinnedRunOutcome {
  readonly ticketId: string;
  readonly mode: 'pinned';
  readonly status: 'resolved' | 'blocked';
  readonly finalRung: Rung;
  readonly resolvedBy?: 'model';
  readonly model?: string;
  readonly attempts: readonly RungAttemptRecord[];
  readonly events: readonly never[];
  readonly parkedReason?: 'pinned_model_exhausted';
}

/**
 * C-4 guard. Checked at RUN time rather than write time because the policy is
 * three-scope: a run-scoped override can collide with a global verifier pin
 * that was perfectly fine on its own, and only the resolved combination is
 * the truth.
 */
export function assertPinnedPreservesMakerVerifier(
  scope: ScopedEscalationPolicy,
  makerRole: AgentRole,
  policy: PinnedModelPolicy,
  resolve: (scope: ScopedEscalationPolicy, role: AgentRole) => EscalationPolicy,
): void {
  if (VERIFIER_ROLES.includes(makerRole)) return;
  for (const verifierRole of VERIFIER_ROLES) {
    const verifierPolicy = resolve(scope, verifierRole);
    if (verifierPolicy.mode === 'pinned' && verifierPolicy.model === policy.model) {
      throw new PinnedPolicyMakerVerifierError(policy.model, makerRole, verifierRole);
    }
  }
}

function assertEvidence(
  rung: Rung,
  outcome: { readonly receipts: readonly FailureReceipt[] },
): void {
  if (outcome.receipts.length === 0) {
    throw new Error(
      `pinned attempt at ${rung} reported a failure with no receipts — a rung ` +
        `cannot fail without evidence`,
    );
  }
}

/**
 * Runs the named model, retries it in place under the same FR-L7 ceiling
 * `locked` uses, and parks when exhausted.
 *
 * NEVER SUBSTITUTES — not to a neighbouring model in the same tier, not to the
 * matrix's fallback chain, not up the ladder. The whole promise of pinning is
 * that nothing else quietly runs, so exhaustion parks with a named reason and
 * the caller decides what happens next.
 */
export async function runPinnedPolicy(
  input: PinnedRunInput,
  policy: PinnedModelPolicy,
  role: AgentRole,
  resolve: (scope: ScopedEscalationPolicy, role: AgentRole) => EscalationPolicy,
): Promise<PinnedRunOutcome> {
  assertPinnedPreservesMakerVerifier(input.policyScope, role, policy, resolve);
  const taskType = input.taskType ?? 'code';
  const ceiling = CONVERGENCE_CEILING[policy.tierKind];
  const attempts: RungAttemptRecord[] = [];

  for (let attempt = 0; attempt < ceiling; attempt++) {
    const outcome = await input.runAttempt({
      // R1 labels the attempt for bookkeeping only — a pinned run never
      // climbs, so the rung is not a claim about this model's tier.
      rung: 'R1',
      ticketId: input.ticketId,
      role,
      taskType,
      modelChain: [policy.model],
    });
    if (outcome.passed) {
      attempts.push({ rung: 'R1', model: policy.model, status: 'passed', receipts: [] });
      return {
        ticketId: input.ticketId,
        mode: 'pinned',
        status: 'resolved',
        finalRung: 'R1',
        resolvedBy: 'model',
        model: policy.model,
        attempts,
        events: [],
      };
    }
    assertEvidence('R1', outcome);
    attempts.push({
      rung: 'R1',
      model: policy.model,
      status: 'failed',
      receipts: outcome.receipts,
      receiptId: outcome.receiptId,
    });
  }

  return {
    ticketId: input.ticketId,
    mode: 'pinned',
    status: 'blocked',
    finalRung: 'R1',
    attempts,
    events: [],
    parkedReason: 'pinned_model_exhausted',
  };
}
