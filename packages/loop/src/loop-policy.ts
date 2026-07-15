import type { FindingRecord } from './findings.js';

/**
 * Loop-convergence policy (BLUEPRINT §3.5, FR-L7, docs/design/FINDING_LOOP_POLICY.md §2-4):
 * classifies what happened to the finding ledger on one review/fix pass, then decides the
 * budget action — CONTINUE, ESCALATE, BLOCK, PARK, or STOP_DIVERGED. The load-bearing
 * distinction (§0 of the design doc): a STALL (same finding surviving fixes) and PROGRESS
 * (new findings as the reviewer sees deeper) are not the same failure and must not share a
 * budget. This module is the pure engine, like findings.ts/coverage.ts/calibration.ts: no
 * event log writes, no model calls — a caller (harbormaster/pipeline) wires it into the
 * actual review/fix loop.
 */

// --- Iteration classification (design doc §2) --------------------------------

export type IterationClass =
  'CLEARED' | 'STALLED' | 'PROGRESSED' | 'MIXED' | 'OSCILLATING';

export interface TargetedFindingOutcome {
  readonly fingerprint: string;
  readonly outcome: 'RESOLVED' | 'STILL_PRESENT';
}

export interface IterationInput {
  /** Verdicts recorded this pass for findings a fix attempt explicitly targeted. */
  readonly targeted: readonly TargetedFindingOutcome[];
  /** Count of brand-new fingerprints opened this pass (`PassReportResult.newFindings.length`). */
  readonly newFindingsOpened: number;
  /** Count of RESOLVED findings that reappeared this pass (`PassReportResult.regressedFindings.length`). */
  readonly regressedCount: number;
}

/** Classifies one pass per the design doc §2 ledger-signature table. */
export function classifyIteration(input: IterationInput): IterationClass {
  if (input.regressedCount > 0) {
    return 'OSCILLATING';
  }
  const resolvedCount = input.targeted.filter((t) => t.outcome === 'RESOLVED').length;
  const stillPresentCount = input.targeted.filter(
    (t) => t.outcome === 'STILL_PRESENT',
  ).length;

  if (stillPresentCount === 0) {
    // Everything targeted resolved (including the trivial case of nothing targeted at all).
    return input.newFindingsOpened > 0 ? 'PROGRESSED' : 'CLEARED';
  }
  if (resolvedCount === 0) {
    return 'STALLED';
  }
  return 'MIXED';
}

// --- Subjective review score asymmetry (US-410 AC-2, FR-L6 asymmetry) --------

export type ReviewSignalAction = 'ACCEPT' | 'BOUNDED_POLISH' | 'ESCALATE_TO_HUMAN';

/**
 * Classifies a subjective 1-10 reviewer score over a *passing* deterministic gate. The return
 * type has no FAIL variant — by construction this function cannot auto-fail a passing gate,
 * mirroring calibration.ts's `gateDecision` proof pattern (BLUEPRINT §2.2 two-track
 * verification: ≥7 accept, 5-6 bounded polish, 1-4 escalate to the human).
 */
export function classifySubjectiveScore(subjectiveScore: number): ReviewSignalAction {
  if (!Number.isInteger(subjectiveScore) || subjectiveScore < 1 || subjectiveScore > 10) {
    throw new RangeError(
      `subjectiveScore must be an integer in [1, 10], got ${subjectiveScore}`,
    );
  }
  if (subjectiveScore >= 7) {
    return 'ACCEPT';
  }
  if (subjectiveScore >= 5) {
    return 'BOUNDED_POLISH';
  }
  return 'ESCALATE_TO_HUMAN';
}

/**
 * The asymmetry itself: a subjective score is only ever advisory over a passing deterministic
 * gate. A failing deterministic gate is governed by the finding ledger's own stall/oscillation
 * budgets (evaluateFindingOutcome below), never by this function — calling it against a failed
 * gate would blur "advisory opinion" with "the thing that actually gates."
 */
export function classifyReviewSignal(input: {
  readonly subjectiveScore: number;
  readonly deterministicGatePassed: boolean;
}): ReviewSignalAction {
  if (!input.deterministicGatePassed) {
    throw new Error(
      'classifyReviewSignal refused: deterministic gate has not passed — a subjective score ' +
        'is advisory-only over a passing gate (US-410 AC-2), never a substitute for the ' +
        'finding ledger budgets on a failing one',
    );
  }
  return classifySubjectiveScore(input.subjectiveScore);
}

// --- Per-finding stall/escalation/oscillation budgets (design doc §3-4) -----

export type StallDecisionAction = 'RETRY_SAME_TIER' | 'ESCALATE' | 'BLOCK' | 'CLEARED';
export type StallDecisionReason =
  'stall' | 'regression' | 'post_escalation_stall' | 'second_oscillation';

export interface StallDecision {
  readonly action: StallDecisionAction;
  readonly reason?: StallDecisionReason;
  /** Same-tier attempts recorded against this finding since its last escalation (or ever, pre-escalation). */
  readonly attemptsAtTier: number;
}

interface FindingBudgetEntry {
  tierAttempts: number;
  escalated: boolean;
  oscillations: number;
}

export interface FindingBudgetTracker {
  /** Folds one recheck outcome into the finding's budget and returns the resulting action. */
  evaluate(
    fingerprint: string,
    outcome: 'RESOLVED' | 'STILL_PRESENT' | 'REGRESSED',
  ): StallDecision;
  /** Read-only peek, e.g. for tests/inspection — does not mutate. */
  peek(fingerprint: string): Readonly<FindingBudgetEntry> | undefined;
}

/**
 * Same finding, same tier: 2 targeted attempts then escalate (never a 3rd same-tier try —
 * design doc §3/§4 row 1). After escalation the budget is +1 attempt at the higher tier, then
 * BLOCK on any further STILL_PRESENT (row 2) — no second 2-strike allowance post-escalation.
 * Any REGRESSED (a RESOLVED finding reappearing) escalates immediately; a second REGRESSED for
 * the same finding blocks (row 5, zero tolerance for oscillation — design doc §3).
 */
export function createFindingBudgetTracker(): FindingBudgetTracker {
  const entries = new Map<string, FindingBudgetEntry>();

  function entryFor(fingerprint: string): FindingBudgetEntry {
    let entry = entries.get(fingerprint);
    if (!entry) {
      entry = { tierAttempts: 0, escalated: false, oscillations: 0 };
      entries.set(fingerprint, entry);
    }
    return entry;
  }

  return {
    evaluate(fingerprint, outcome) {
      const entry = entryFor(fingerprint);

      if (outcome === 'RESOLVED') {
        entries.delete(fingerprint);
        return { action: 'CLEARED', attemptsAtTier: 0 };
      }

      if (outcome === 'REGRESSED') {
        entry.oscillations += 1;
        if (entry.oscillations >= 2) {
          return {
            action: 'BLOCK',
            reason: 'second_oscillation',
            attemptsAtTier: entry.tierAttempts,
          };
        }
        entry.escalated = true;
        entry.tierAttempts = 0;
        return { action: 'ESCALATE', reason: 'regression', attemptsAtTier: 0 };
      }

      // STILL_PRESENT
      if (entry.escalated) {
        entry.tierAttempts += 1;
        return {
          action: 'BLOCK',
          reason: 'post_escalation_stall',
          attemptsAtTier: entry.tierAttempts,
        };
      }
      entry.tierAttempts += 1;
      if (entry.tierAttempts >= 2) {
        entry.escalated = true;
        entry.tierAttempts = 0;
        return { action: 'ESCALATE', reason: 'stall', attemptsAtTier: 2 };
      }
      return { action: 'RETRY_SAME_TIER', attemptsAtTier: entry.tierAttempts };
    },
    peek(fingerprint) {
      const entry = entries.get(fingerprint);
      return entry ? { ...entry } : undefined;
    },
  };
}

// --- Progress-loop convergence + tier-aware ceiling (design doc §3) ---------

/** Frontier/metered (tokens cost money) vs local/owned-hardware (tokens ~free) — FINDING_LOOP_POLICY §3. */
export type EconomicTier = 'metered' | 'local';

/** Hard ceiling on a PROGRESSED-classified pass count for metered tiers. */
export const METERED_PROGRESS_CEILING_CAP = 8;
/** Floor (not a hard cap — the wall-clock watchdog is the backstop) on local tiers. */
export const LOCAL_PROGRESS_CEILING_FLOOR = 12;

/**
 * `base(3) + ticket_points`, capped at 8 on frontier/metered tiers; on local/owned-hardware
 * tiers the ceiling instead rises to at least 12 (localFrontier-proven — 12 iterations landed
 * complete SDLCs that a flat cap of 3 hard-escalated). Never below the floor/cap regardless of
 * how small `ticketPoints` is.
 */
export function computeProgressCeiling(ticketPoints: number, tier: EconomicTier): number {
  const base = 3 + ticketPoints;
  return tier === 'metered'
    ? Math.min(base, METERED_PROGRESS_CEILING_CAP)
    : Math.max(base, LOCAL_PROGRESS_CEILING_FLOOR);
}

export type ProgressCeilingAction = 'CONTINUE' | 'PARK';

export interface ProgressCeilingCheck {
  readonly ceiling: number;
  readonly action: ProgressCeilingAction;
}

/**
 * Only meaningful for a pass classified PROGRESSED (other classes are governed by
 * `FindingBudgetTracker`, which strikes well before this ceiling). Hitting the ceiling while
 * still PROGRESSED is a park, not a failure (§3: "the ticket is decomposing badly, split it").
 */
export function checkProgressCeiling(
  passesUsed: number,
  ticketPoints: number,
  tier: EconomicTier,
): ProgressCeilingCheck {
  const ceiling = computeProgressCeiling(ticketPoints, tier);
  return { ceiling, action: passesUsed >= ceiling ? 'PARK' : 'CONTINUE' };
}

export interface PassOpenCount {
  readonly pass: number;
  readonly openCount: number;
  readonly iterationClass: IterationClass;
}

export type ConvergenceStatus = 'CONVERGING' | 'DIVERGED';

/**
 * Sliding 2-pass convergence window (design doc §3): `open_findings` must strictly decrease OR
 * the pass must be PROGRESSED. Two consecutive passes with non-decreasing open count and no
 * prior-resolutions is divergence — stop now. A PROGRESSED pass always satisfies the OR clause
 * by construction, so a loop that is still resolving priors is never killed just because new
 * findings surfaced (§4's mirror rule).
 */
export function checkConvergence(history: readonly PassOpenCount[]): ConvergenceStatus {
  if (history.length < 2) {
    return 'CONVERGING';
  }
  const prev = history[history.length - 2]!;
  const curr = history[history.length - 1]!;
  if (curr.iterationClass === 'PROGRESSED') {
    return 'CONVERGING';
  }
  return curr.openCount < prev.openCount ? 'CONVERGING' : 'DIVERGED';
}

// --- Combined per-pass policy decision ---------------------------------------

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
