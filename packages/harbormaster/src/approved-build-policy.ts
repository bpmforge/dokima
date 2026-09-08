/**
 * `approved-build-v1` — the recorded decision about what an approved build may
 * do unattended (W23-01, the linked child of W13-32).
 *
 * W13-32's first acceptance criterion is not a coding instruction: "DECIDE
 * FIRST, AND RECORD IT: which documented default at each non-NEVER-AUTO pause
 * site is acceptable to take unattended." This module is that record, written
 * as a pure function so the decision is testable rather than prose, and
 * versioned so turning it on is an explicit per-project opt-in rather than a
 * new meaning for a setting people already chose (D-032, C-5).
 *
 * THREE PROPERTIES ARE THE WHOLE POINT.
 *
 * 1. **Authorization is runtime-owned.** Every input here is a fact the
 *    runtime computed: a digest it hashed, a scope it checked, a ledger it
 *    read, an identity it minted. Nothing a model emits appears in
 *    `ApprovedBuildRequest`, so there is no field an agent session can set to
 *    authorize itself. A model may still *cause* a request (it asked to run a
 *    command) — it can never *be* the reason one is allowed.
 * 2. **It fails closed.** An unrecognized situation, an unrecognized pause
 *    site, a missing approval, an approval whose digest no longer matches what
 *    is about to run — each returns `ask_human`, never `proceed`. The default
 *    branch is the safe one, which is why the situation union is exhaustive
 *    and still has a fallthrough.
 * 3. **NEVER-AUTO is delegated, never re-listed.** `isNeverAutoPauseSite` and
 *    the rule classifier are called, not copied. C-5's defence is that the two
 *    NEVER-AUTO lists in this package derive from one another; a third list
 *    here would be the drift this ticket exists to avoid.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: touch `resolvePauseAction`, which stays
 * exactly as it is for legacy callers, and change any default for a project
 * that has not recorded an `approved-build-v1` approval. A legacy
 * `autonomy=auto` project gets legacy behaviour, decided by the same
 * `resolvePauseAction` it would have got before this file existed.
 */

import {
  ask,
  go,
  decideMachineAccept,
  type ApprovedBuildReviewFacts,
} from './approved-build-accept.js';
import { resolvePauseAction } from './autonomy.js';
import {
  isNeverAutoPauseSite,
  type AutonomyMode,
  type PauseSiteKind,
} from './autonomy-types.js';
import { classifyByRules, isNeverAuto } from './review-queue-classifier.js';
import type { ActionDescriptor } from './review-queue-types.js';

/** The one policy version this module implements. An approval carrying anything else is not an approval. */
export const APPROVED_BUILD_POLICY_VERSION = 'approved-build-v1';

/**
 * A validated approval, as the runtime reconstructs it from the recorded
 * approval event (AB-02/W23-02 builds that persistence; this module only ever
 * reads the reconstructed shape).
 *
 * `inputDigest` covers the approved design, stories, acceptance, plan scope,
 * model policy and budget — and deliberately not execution status, so
 * progress does not invalidate the approval while a scope edit does.
 * Credentials are refs elsewhere and never reach this type.
 */
export interface ApprovedBuildPolicy {
  readonly version: string;
  readonly projectId: string;
  /** Event id of the approval this was reconstructed from — the audit anchor, not an authorization token. */
  readonly approvalId: string;
  readonly inputDigest: string;
  readonly budgetCents: number;
  readonly maxRepairRounds: number;
}

/**
 * What the runtime is about to do, one discriminated case per row of the
 * release pause table (`docs/work/automated-build-handoff/IMPLEMENTATION_PLAN.md`
 * §4). The situation is classified by the runtime from what it is calling, not
 * parsed out of model output.
 */
export type ApprovedBuildSituationKind =
  | 'implement-ticket'
  | 'run-configured-check'
  | 'repair-finding'
  | 'retry-transient-provider'
  | 'machine-accept'
  | 'ordinary-implementation-detail'
  | 'ambiguous-requirement'
  | 'scope-or-stack-change'
  | 'budget-or-escalation'
  | 'missing-capability'
  | 'protected-action';

/** Everything the decision is allowed to depend on. Every field is runtime-computed. */
export interface ApprovedBuildFacts {
  /** Digest of the design/stories/acceptance/scope/model-policy/budget as they stand right now. */
  readonly currentInputDigest: string;
  readonly pauseSite?: PauseSiteKind;
  readonly action?: ActionDescriptor;
  /** The runtime checked the edit against the ticket's write_scope; undefined is not "yes". */
  readonly withinApprovedScope?: boolean;
  readonly requestedCents?: number;
  readonly repairRoundsUsed?: number;
  readonly providerAttemptsUsed?: number;
  readonly providerAttemptLimit?: number;
  /** Names the capability that is absent (scanner, credential, independent reviewer). */
  readonly missingCapability?: string | null;
  readonly review?: ApprovedBuildReviewFacts;
}

export interface ApprovedBuildRequest {
  readonly situation: ApprovedBuildSituationKind;
  /** The reconstructed approval, or null when the project never recorded one. */
  readonly policy: ApprovedBuildPolicy | null;
  /** The project's legacy autonomy dial, consulted only when there is no valid approval. */
  readonly mode: AutonomyMode;
  readonly facts: ApprovedBuildFacts;
}

export type { ApprovedBuildReviewFacts };

export type ApprovedBuildAction =
  | 'proceed'
  | 'proceed_bounded_retry'
  | 'machine_accept'
  | 'ask_human'
  | 'report_missing_capability';

/**
 * `ruleId` names the row that fired. Two rows returning `ask_human` for
 * different reasons is exactly how a policy function rots into "it asks
 * sometimes", so the tests assert the id, not just the action.
 */
export interface ApprovedBuildDecision {
  readonly action: ApprovedBuildAction;
  readonly ruleId: string;
  readonly reason: string;
}

const SITUATIONS: readonly ApprovedBuildSituationKind[] = [
  'implement-ticket',
  'run-configured-check',
  'repair-finding',
  'retry-transient-provider',
  'machine-accept',
  'ordinary-implementation-detail',
  'ambiguous-requirement',
  'scope-or-stack-change',
  'budget-or-escalation',
  'missing-capability',
  'protected-action',
];

/** True when the situation string is one this module actually implements — a renamed or forged one is not. */
function isKnownSituation(value: unknown): value is ApprovedBuildSituationKind {
  return typeof value === 'string' && (SITUATIONS as readonly string[]).includes(value);
}

/**
 * Whether the described action is protected by the existing rule-first
 * classifier. Delegates to `classifyByRules` + `isNeverAuto` rather than
 * re-testing branches and commands here (FR-N2, C-5).
 */
function actionIsProtected(action: ActionDescriptor | undefined): boolean {
  if (!action) return false;
  return isNeverAuto(classifyByRules(action));
}

/**
 * The decision. Ordered fail-closed: the branches that can only ever *stop*
 * work are evaluated before any branch that can let it continue, so a request
 * that is both protected and routine is protected.
 */
export function decideApprovedBuildAction(
  request: ApprovedBuildRequest,
): ApprovedBuildDecision {
  const { situation, policy, mode, facts } = request;

  // 1. Unrecognized situation. A renamed constant, a typo, or a case a later
  //    card added without teaching this function about it — none of them can
  //    be proven safe, so none of them proceed.
  if (!isKnownSituation(situation)) {
    return ask(
      'unknown-situation',
      `unrecognized situation "${String(situation)}" — fails closed`,
    );
  }

  // 2. C-5, before anything else and regardless of policy. A NEVER-AUTO pause
  //    site or a rule-classified protected action always asks, and
  //    `isNeverAutoPauseSite` itself treats an unrecognized site as NEVER-AUTO.
  if (facts.pauseSite !== undefined && isNeverAutoPauseSite(facts.pauseSite)) {
    return ask(
      'c5-never-auto-pause-site',
      `pause site "${facts.pauseSite}" is NEVER-AUTO (C-5)`,
    );
  }
  if (actionIsProtected(facts.action)) {
    return ask(
      'c5-protected-action',
      'the rule classifier rates this action NEVER-AUTO (FR-N2, C-5)',
    );
  }
  if (situation === 'protected-action') {
    return ask(
      'protected-action',
      'main/master merge, release, publication or deploy is a separate human decision',
    );
  }

  // 3. No valid approval: legacy behaviour, unchanged. A project that chose
  //    `auto` before this feature existed chose it for the old meaning, so it
  //    keeps the old meaning until someone records an approved-build-v1
  //    approval (D-032).
  if (policy === null || policy.version !== APPROVED_BUILD_POLICY_VERSION) {
    const legacy = resolvePauseAction(mode, facts.pauseSite ?? 'clarification');
    return legacy === 'take_default'
      ? go(
          'legacy-autonomy-default',
          'no approved-build-v1 approval — legacy autonomy dial takes its documented default',
        )
      : ask(
          'legacy-requires-opt-in',
          'no approved-build-v1 approval — legacy interactive behaviour preserved',
        );
  }

  // 4. The approval must describe what is about to run. A scope, story,
  //    acceptance, model-policy or budget edit changes the digest, and an
  //    approval of something else is not an approval of this.
  if (policy.inputDigest !== facts.currentInputDigest) {
    return ask(
      'approval-stale',
      'the approved inputs digest does not match the current one — the approved build changed',
    );
  }

  // 5. Per-situation rules. Everything below has already survived C-5, a valid
  //    versioned approval, and a matching digest.
  switch (situation) {
    case 'implement-ticket':
      return facts.withinApprovedScope === true
        ? go(
            'implement-inside-scope',
            'implementing an approved ticket inside its approved write scope',
          )
        : ask(
            'implement-outside-scope',
            'the edit is outside the approved write scope, or scope was not checked',
          );

    case 'run-configured-check':
      return go(
        'run-configured-check',
        'running configured tests/scanners inside the allowed sandbox and network policy',
      );

    case 'ordinary-implementation-detail':
      return go(
        'ordinary-detail',
        'an ordinary implementation choice with no material requirement decision — manufacturing a clarification here is itself the defect',
      );

    case 'repair-finding': {
      if (facts.withinApprovedScope !== true) {
        return ask(
          'repair-outside-scope',
          'the repair falls outside the approved acceptance/scope',
        );
      }
      const used = facts.repairRoundsUsed ?? 0;
      if (used >= policy.maxRepairRounds) {
        return ask(
          'repair-rounds-exhausted',
          `repair rounds exhausted (${used}/${policy.maxRepairRounds})`,
        );
      }
      return go(
        'repair-inside-scope',
        `repairing inside the approved acceptance, round ${used + 1} of ${policy.maxRepairRounds}`,
        'proceed_bounded_retry',
      );
    }

    case 'retry-transient-provider': {
      const used = facts.providerAttemptsUsed ?? 0;
      const limit = facts.providerAttemptLimit ?? 0;
      if (used >= limit) {
        return ask(
          'provider-retries-exhausted',
          `provider retry limit reached (${used}/${limit})`,
        );
      }
      return go(
        'provider-transient-retry',
        `retrying a transient provider failure under the existing limit (${used + 1}/${limit})`,
        'proceed_bounded_retry',
      );
    }

    case 'budget-or-escalation': {
      const requested = facts.requestedCents ?? Number.POSITIVE_INFINITY;
      return requested > policy.budgetCents
        ? ask(
            'budget-exceeded',
            `requested spend ${requested} exceeds the approved budget ${policy.budgetCents}`,
          )
        : ask(
            'escalation-boundary',
            'crossing an approval-gated model boundary is asked even inside budget — spend is never escalated silently',
          );
    }

    case 'missing-capability':
      return {
        action: 'report_missing_capability',
        ruleId: 'missing-capability',
        reason: `required capability unavailable: ${facts.missingCapability ?? 'unnamed'} — this is not a completed build`,
      };

    case 'ambiguous-requirement':
      return ask(
        'ambiguous-requirement',
        'a requirement the approved stories do not cover, or two behaviours that conflict — ask, and continue unrelated work',
      );

    case 'scope-or-stack-change':
      return ask(
        'scope-or-stack-change',
        'new scope, a new dependency or stack, auth/crypto, or a destructive operation',
      );

    case 'machine-accept':
      return decideMachineAccept(facts.review);

    default:
      // Unreachable while the union and SITUATIONS agree; kept because the one
      // that stops being unreachable must not become the one that proceeds.
      return ask('unhandled-situation', 'no rule handled this situation — fails closed');
  }
}
