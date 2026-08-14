/**
 * Escalation policy engine (D-018, BLUEPRINT §3.3): resolves the
 * three-scope, per-role policy setting and drives the ticket's climb
 * accordingly.
 *
 * `ladder` delegates outright to ladder.ts's own R0-R4 engine — this file
 * adds no branch inside that path, so ladder-mode behavior (including
 * FR-G3's evidence-triggered-only guarantee) is exactly ladder.ts's,
 * unchanged. `locked` and `token-gated` are new climb variants that reuse
 * the same rung/model resolution shape ladder.ts uses
 * (routing/matrix.ts's `resolveModelChain`) without depending on
 * ladder.ts's private helpers (this package cannot widen ladder.ts's
 * exports from this ticket's write_scope, `escalation/policy*` only).
 *
 * Both new modes reuse `MissingFailureEvidenceError` from ladder.ts so a
 * failure reported with no receipts is refused identically in every mode
 * (FR-G3: evidence-triggered, never vibes-triggered, unaffected by
 * policy). Neither mode touches routing's maker!=verifier guard
 * (routing/maker-verifier.ts) at all — that guard runs at the point the
 * caller resolves an actual model call, entirely outside this module, so
 * no policy mode can weaken or bypass it (see policy.test.ts's per-mode
 * check that the guard's behavior is identical regardless of which
 * policy just ran).
 */

import { resolveModelChain, resolveScopedValue } from '../routing/matrix.js';
import { ROLE_CHALLENGER, ROLE_CODING_AGENT } from '../routing/types.js';
import type { AgentRole, ScopedRoleMatrix, TaskType } from '../routing/types.js';
import {
  noopEscalationEventSink,
  type EscalationEvent,
  type EscalationEventSink,
} from './events.js';
import {
  MissingFailureEvidenceError,
  runEscalationLadder,
  type AttemptRunner,
  type EscalationLadderOutcome,
  type RungAttemptRecord,
} from './ladder.js';
import { noopMemoryConsultHook, type MemoryConsultHook } from './memory-hook.js';
import { runPinnedPolicy } from './policy-pinned.js';
import { RUNG_ORDER, type FailureReceipt, type GateOutcome, type Rung } from './types.js';
import {
  CONVERGENCE_CEILING,
  LADDER_POLICY,
  noopEscalationTokenHook,
  type EscalationPolicy,
  type EscalationTokenHook,
  type LockedPolicy,
  type PolicyRung,
  type ScopedEscalationPolicy,
  type TokenGatedPolicy,
} from './policy-types.js';

export type {
  EscalationApprovalRiskClass,
  EscalationPolicy,
  EscalationPolicyMode,
  EscalationToken,
  EscalationTokenHook,
  EscalationTokenRequest,
  LadderPolicy,
  LockedPolicy,
  PinnedModelPolicy,
  PolicyRung,
  ScopedEscalationPolicy,
  TierKind,
  TokenGatedPolicy,
} from './policy-types.js';
export {
  CONVERGENCE_CEILING,
  LADDER_POLICY,
  noopEscalationTokenHook,
  PinnedPolicyMakerVerifierError,
} from './policy-types.js';

/** Resolves the role's escalation policy across run > project > global scopes (D-018: three-scope, per role); 'ladder' when nothing is set for the role — ladder stays the default per D-018. */
export function resolveEscalationPolicy(
  scope: ScopedEscalationPolicy,
  role: AgentRole,
): EscalationPolicy {
  return resolveScopedValue(scope, role)?.value ?? LADDER_POLICY;
}

export type PolicyParkedReason =
  | 'locked_ceiling_reached'
  | 'awaiting_escalation_token'
  | 'pinned_model_exhausted';

export type EscalationPolicyOutcome = EscalationLadderOutcome & {
  readonly mode: EscalationPolicy['mode'];
  /** Present only when `status` is 'blocked' for a reason other than ladder.ts's own R4 (locked's ceiling, or token-gated's boundary park). */
  readonly parkedReason?: PolicyParkedReason;
};

/** Lets a caller resume a parked token-gated run (once a token may now exist) without re-attempting already-failed rungs. */
export interface TokenGatedResumeState {
  readonly priorAttempts: readonly RungAttemptRecord[];
  readonly lastFailure: {
    readonly rung: Rung;
    readonly receipts: readonly FailureReceipt[];
    readonly receiptId?: string;
  };
}

export interface EscalationPolicyInput {
  readonly ticketId: string;
  readonly criterion: string;
  readonly actorId: string;
  readonly matrix: ScopedRoleMatrix;
  readonly policyScope: ScopedEscalationPolicy;
  readonly role?: AgentRole;
  readonly taskType?: TaskType;
  readonly frontierRole?: AgentRole;
  readonly runAttempt: AttemptRunner;
  readonly memoryHook?: MemoryConsultHook;
  readonly tokenHook?: EscalationTokenHook;
  readonly sink?: EscalationEventSink;
  readonly now?: () => string;
  /** token-gated only: resumes a previously parked run, skipping the rungs already recorded in `priorAttempts` instead of re-running them. */
  readonly resume?: TokenGatedResumeState;
}

function assertEvidence(rung: Rung, outcome: GateOutcome): void {
  if (!outcome.passed && outcome.receipts.length === 0) {
    throw new MissingFailureEvidenceError(rung);
  }
}

/** Resolves one policy-pinned/gated rung's model — R1/R2 from the base (role, taskType) chain, R3 from `frontierRole`'s 'escalation' task type, mirroring ladder.ts's own resolution without depending on its private helpers. */
function modelForPolicyRung(
  matrix: ScopedRoleMatrix,
  role: AgentRole,
  taskType: TaskType,
  frontierRole: AgentRole,
  rung: PolicyRung,
): string {
  if (rung === 'R3') {
    return resolveModelChain(matrix, frontierRole, 'escalation').chain[0]!;
  }
  const chain = resolveModelChain(matrix, role, taskType).chain;
  return rung === 'R1' ? chain[0]! : (chain[1] ?? chain[0]!);
}

/** Runs the ticket's escalation policy for `role` (D-018): dispatches to ladder/locked/token-gated per the resolved policy. */
export async function runEscalationPolicy(
  input: EscalationPolicyInput,
): Promise<EscalationPolicyOutcome> {
  const role = input.role ?? ROLE_CODING_AGENT;
  const policy = resolveEscalationPolicy(input.policyScope, role);
  switch (policy.mode) {
    case 'ladder': {
      const outcome = await runEscalationLadder({
        ticketId: input.ticketId,
        criterion: input.criterion,
        actorId: input.actorId,
        matrix: input.matrix,
        role,
        taskType: input.taskType,
        frontierRole: input.frontierRole,
        runAttempt: input.runAttempt,
        memoryHook: input.memoryHook,
        sink: input.sink,
        now: input.now,
      });
      return { ...outcome, mode: 'ladder' };
    }
    case 'locked':
      return runLockedPolicy(input, policy, role);
    case 'token-gated':
      return runTokenGatedPolicy(input, policy, role);
    case 'pinned':
      // The resolver is INJECTED rather than imported by the chapter: the C-4
      // guard needs to resolve other roles' policies, and importing
      // `resolveEscalationPolicy` back from this file would make the two
      // modules mutually dependent — which `validate-circular-deps` gates.
      return runPinnedPolicy(input, policy, role, resolveEscalationPolicy);
  }
}

/**
 * `locked` (D-018): retries the SAME pinned tier under FR-L7's tier-aware
 * convergence ceiling — it never advances to another rung, so it can
 * never emit an escalation event. A failure past the ceiling parks
 * blocked-with-evidence instead of climbing.
 */
async function runLockedPolicy(
  input: EscalationPolicyInput,
  policy: LockedPolicy,
  role: AgentRole,
): Promise<EscalationPolicyOutcome> {
  const taskType = input.taskType ?? 'code';
  const frontierRole = input.frontierRole ?? ROLE_CHALLENGER;
  const model = modelForPolicyRung(
    input.matrix,
    role,
    taskType,
    frontierRole,
    policy.pinnedTier,
  );
  const ceiling = CONVERGENCE_CEILING[policy.tierKind];

  const attempts: RungAttemptRecord[] = [];
  for (let attempt = 0; attempt < ceiling; attempt++) {
    const outcome = await input.runAttempt({
      rung: policy.pinnedTier,
      ticketId: input.ticketId,
      role,
      taskType,
      modelChain: [model],
    });
    if (outcome.passed) {
      attempts.push({ rung: policy.pinnedTier, model, status: 'passed', receipts: [] });
      return {
        ticketId: input.ticketId,
        mode: 'locked',
        status: 'resolved',
        finalRung: policy.pinnedTier,
        resolvedBy: 'model',
        model,
        attempts,
        events: [],
      };
    }
    assertEvidence(policy.pinnedTier, outcome);
    attempts.push({
      rung: policy.pinnedTier,
      model,
      status: 'failed',
      receipts: outcome.receipts,
      receiptId: outcome.receiptId,
    });
  }

  return {
    ticketId: input.ticketId,
    mode: 'locked',
    status: 'blocked',
    finalRung: policy.pinnedTier,
    attempts,
    events: [],
    parkedReason: 'locked_ceiling_reached',
  };
}

/**
 * `token-gated` (D-018, FR-N2): climbs exactly like `ladder` until it
 * would cross `namedTier` — that one crossing requires a minted
 * 'escalation' token (never auto-minted here, see `noopEscalationTokenHook`).
 * Absent a token it parks; once a token is present it climbs the one
 * rung and resumes normal evidence-triggered climbing beyond it.
 */
async function runTokenGatedPolicy(
  input: EscalationPolicyInput,
  policy: TokenGatedPolicy,
  role: AgentRole,
): Promise<EscalationPolicyOutcome> {
  const taskType = input.taskType ?? 'code';
  const frontierRole = input.frontierRole ?? ROLE_CHALLENGER;
  const tokenHook = input.tokenHook ?? noopEscalationTokenHook;
  const sink = input.sink ?? noopEscalationEventSink;
  const now = input.now ?? (() => new Date().toISOString());
  const memoryHook = input.memoryHook ?? noopMemoryConsultHook;

  const attempts: RungAttemptRecord[] = input.resume
    ? [...input.resume.priorAttempts]
    : [];
  const events: EscalationEvent[] = [];

  let lastFailure:
    { rung: Rung; receipts: readonly FailureReceipt[]; receiptId?: string } | undefined =
    input.resume?.lastFailure;

  if (!input.resume) {
    const memoryResult = await memoryHook.consult({
      ticketId: input.ticketId,
      criterion: input.criterion,
    });
    if (memoryResult.answered) {
      attempts.push({ rung: 'R0', status: 'memory_hit', receipts: [] });
      return {
        ticketId: input.ticketId,
        mode: 'token-gated',
        status: 'resolved',
        finalRung: 'R0',
        resolvedBy: 'memory',
        attempts,
        events,
      };
    }
    attempts.push({ rung: 'R0', status: 'no_memory_hit', receipts: [] });
  }

  const lastIndex = lastFailure
    ? RUNG_ORDER.indexOf(lastFailure.rung)
    : RUNG_ORDER.indexOf('R0');
  const climbableRungs = ['R1', 'R2', 'R3', 'R4'] as const;
  const remainingRungs = climbableRungs.filter(
    (rung) => RUNG_ORDER.indexOf(rung) > lastIndex,
  );

  for (const rung of remainingRungs) {
    if (lastFailure) {
      if (lastFailure.rung === policy.namedTier) {
        const token = await tokenHook.checkToken({
          ticketId: input.ticketId,
          boundary: policy.namedTier,
        });
        if (!token) {
          return {
            ticketId: input.ticketId,
            mode: 'token-gated',
            status: 'blocked',
            finalRung: lastFailure.rung,
            attempts,
            events,
            parkedReason: 'awaiting_escalation_token',
          };
        }
      }
      const advanceEvent: EscalationEvent = {
        type: rung === 'R4' ? 'escalation.blocked' : 'escalation.rung_advanced',
        ticketId: input.ticketId,
        fromRung: lastFailure.rung,
        toRung: rung,
        actorId: input.actorId,
        receipts: lastFailure.receipts,
        receiptId: lastFailure.receiptId,
        occurredAt: now(),
      };
      events.push(advanceEvent);
      await sink.emit(advanceEvent);
    }

    if (rung === 'R4') {
      return {
        ticketId: input.ticketId,
        mode: 'token-gated',
        status: 'blocked',
        finalRung: 'R4',
        attempts,
        events,
      };
    }

    const model = modelForPolicyRung(input.matrix, role, taskType, frontierRole, rung);
    const outcome = await input.runAttempt({
      rung,
      ticketId: input.ticketId,
      role,
      taskType,
      modelChain: [model],
    });
    if (outcome.passed) {
      attempts.push({ rung, model, status: 'passed', receipts: [] });
      return {
        ticketId: input.ticketId,
        mode: 'token-gated',
        status: 'resolved',
        finalRung: rung,
        resolvedBy: 'model',
        model,
        attempts,
        events,
      };
    }
    assertEvidence(rung, outcome);
    attempts.push({
      rung,
      model,
      status: 'failed',
      receipts: outcome.receipts,
      receiptId: outcome.receiptId,
    });
    lastFailure = { rung, receipts: outcome.receipts, receiptId: outcome.receiptId };
  }

  /* istanbul ignore next -- RUNG_ORDER always ends in 'R4', whose branch above always returns. */
  throw new Error('unreachable: token-gated policy ran past R4');
}
