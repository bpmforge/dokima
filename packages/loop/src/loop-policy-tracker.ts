import type { FindingRecord } from './findings.js';
import {
  classifyIteration,
  type IterationClass,
  type TargetedFindingOutcome,
} from './loop-policy-classify.js';
import {
  createFindingBudgetTracker,
  type FindingBudgetTracker,
} from './loop-policy-budget.js';
import {
  checkConvergence,
  checkProgressCeiling,
  type EconomicTier,
  type PassOpenCount,
} from './loop-policy-convergence.js';

/**
 * Combined per-pass policy decision (CODE_BOOK_PROTOCOL chapter of loop-policy.ts): ties
 * classification (loop-policy-classify.ts) + per-finding budgets (loop-policy-budget.ts) +
 * convergence/ceiling (loop-policy-convergence.ts) into one CONTINUE/CLEARED/ESCALATE/BLOCK/
 * PARK/STOP_DIVERGED decision per pass.
 */

export interface RecordPassInput {
  readonly pass: number;
  /** From `FindingLedger.reportPass()`. */
  readonly newFindingsOpened: number;
  readonly regressedFindings: readonly FindingRecord[];
  /** Findings this pass explicitly rechecked with a RECORDED (non-INCOMPLETE) verdict. */
  readonly recheckedFindings: readonly {
    readonly finding: FindingRecord;
    readonly outcome: 'RESOLVED' | 'STILL_PRESENT';
  }[];
  /** Total OPEN/FIX_ATTEMPTED/REGRESSED findings after this pass — the convergence window's `open_findings`. */
  readonly openFindingsCount: number;
  readonly ticketPoints: number;
  readonly tier: EconomicTier;
}

export type LoopPolicyActionKind =
  'CONTINUE' | 'CLEARED' | 'ESCALATE' | 'BLOCK' | 'PARK' | 'STOP_DIVERGED';

export interface LoopPolicyActionBase {
  readonly kind: LoopPolicyActionKind;
  readonly pass: number;
  readonly iterationClass: IterationClass;
}

export interface LoopPolicyContinue extends LoopPolicyActionBase {
  readonly kind: 'CONTINUE';
}

export interface LoopPolicyCleared extends LoopPolicyActionBase {
  readonly kind: 'CLEARED';
}

export interface LoopPolicyEscalate extends LoopPolicyActionBase {
  readonly kind: 'ESCALATE';
  readonly reason: 'stall' | 'regression';
  readonly findings: readonly FindingRecord[];
}

export interface LoopPolicyBlock extends LoopPolicyActionBase {
  readonly kind: 'BLOCK';
  readonly reason: 'post_escalation_stall' | 'second_oscillation';
  /** The ledger evidence a BLOCK must carry (policy §4 row 2/row 5). */
  readonly findings: readonly FindingRecord[];
}

export interface LoopPolicyPark extends LoopPolicyActionBase {
  readonly kind: 'PARK';
  readonly reason: 'decomposition_signal';
  readonly ceiling: number;
}

export interface LoopPolicyDiverged extends LoopPolicyActionBase {
  readonly kind: 'STOP_DIVERGED';
  readonly reason: 'flat_open_count';
}

export type LoopPolicyAction =
  | LoopPolicyContinue
  | LoopPolicyCleared
  | LoopPolicyEscalate
  | LoopPolicyBlock
  | LoopPolicyPark
  | LoopPolicyDiverged;

export interface LoopConvergenceTracker {
  readonly passesUsed: number;
  readonly openCountHistory: readonly PassOpenCount[];
  recordPass(input: RecordPassInput): LoopPolicyAction;
}

/**
 * Ties classification + per-finding budgets + convergence/ceiling into one per-pass decision.
 * BLOCK/ESCALATE from a specific finding's budget always wins over the pass-level convergence
 * check — a single finding oscillating or exhausting its post-escalation budget is reason
 * enough regardless of how the rest of the pass looks.
 */
export function createLoopConvergenceTracker(
  budgetTracker: FindingBudgetTracker = createFindingBudgetTracker(),
): LoopConvergenceTracker {
  const openCountHistory: PassOpenCount[] = [];
  let passesUsed = 0;

  return {
    get passesUsed() {
      return passesUsed;
    },
    get openCountHistory() {
      return openCountHistory.slice();
    },
    recordPass(input) {
      const targeted: TargetedFindingOutcome[] = input.recheckedFindings.map((r) => ({
        fingerprint: r.finding.fingerprint,
        outcome: r.outcome,
      }));
      const iterationClass = classifyIteration({
        targeted,
        newFindingsOpened: input.newFindingsOpened,
        regressedCount: input.regressedFindings.length,
      });

      // Per-finding budgets: regressions first (worst signal), then still-present stalls,
      // then clear the resolved ones out of the tracker.
      for (const finding of input.regressedFindings) {
        const decision = budgetTracker.evaluate(finding.fingerprint, 'REGRESSED');
        if (decision.action === 'BLOCK') {
          return {
            kind: 'BLOCK',
            pass: input.pass,
            iterationClass,
            reason: 'second_oscillation',
            findings: [finding],
          };
        }
        if (decision.action === 'ESCALATE') {
          return {
            kind: 'ESCALATE',
            pass: input.pass,
            iterationClass,
            reason: 'regression',
            findings: [finding],
          };
        }
      }
      for (const r of input.recheckedFindings) {
        if (r.outcome !== 'STILL_PRESENT') {
          continue;
        }
        const decision = budgetTracker.evaluate(r.finding.fingerprint, 'STILL_PRESENT');
        if (decision.action === 'BLOCK') {
          return {
            kind: 'BLOCK',
            pass: input.pass,
            iterationClass,
            reason: 'post_escalation_stall',
            findings: [r.finding],
          };
        }
        if (decision.action === 'ESCALATE') {
          return {
            kind: 'ESCALATE',
            pass: input.pass,
            iterationClass,
            reason: 'stall',
            findings: [r.finding],
          };
        }
      }
      for (const r of input.recheckedFindings) {
        if (r.outcome === 'RESOLVED') {
          budgetTracker.evaluate(r.finding.fingerprint, 'RESOLVED');
        }
      }

      passesUsed += 1;
      openCountHistory.push({
        pass: input.pass,
        openCount: input.openFindingsCount,
        iterationClass,
      });

      if (iterationClass === 'CLEARED') {
        return { kind: 'CLEARED', pass: input.pass, iterationClass };
      }
      if (iterationClass === 'PROGRESSED') {
        const ceilingCheck = checkProgressCeiling(
          passesUsed,
          input.ticketPoints,
          input.tier,
        );
        if (ceilingCheck.action === 'PARK') {
          return {
            kind: 'PARK',
            pass: input.pass,
            iterationClass,
            reason: 'decomposition_signal',
            ceiling: ceilingCheck.ceiling,
          };
        }
        return { kind: 'CONTINUE', pass: input.pass, iterationClass };
      }

      // STALLED or MIXED, and no per-finding budget fired yet (e.g. the first strike on each
      // finding) — governed by the pass-level convergence window instead.
      if (checkConvergence(openCountHistory) === 'DIVERGED') {
        return {
          kind: 'STOP_DIVERGED',
          pass: input.pass,
          iterationClass,
          reason: 'flat_open_count',
        };
      }
      return { kind: 'CONTINUE', pass: input.pass, iterationClass };
    },
  };
}
