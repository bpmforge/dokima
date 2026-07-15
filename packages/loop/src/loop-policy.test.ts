import { describe, expect, it } from 'vitest';
import type { FindingRecord } from './findings.js';
import {
  LOCAL_PROGRESS_CEILING_FLOOR,
  METERED_PROGRESS_CEILING_CAP,
  checkConvergence,
  checkProgressCeiling,
  classifyIteration,
  classifyReviewSignal,
  classifySubjectiveScore,
  computeProgressCeiling,
  createFindingBudgetTracker,
  createLoopConvergenceTracker,
  type PassOpenCount,
} from './loop-policy.js';

function stubFinding(fingerprint: string): FindingRecord {
  return {
    id: `F-T-${fingerprint}`,
    fingerprint,
    ticketId: 'T',
    ruleId: null,
    severity: 'HIGH',
    file: 'a.ts',
    issue: 'issue',
    fixHint: null,
    state: 'FIX_ATTEMPTED',
    attempts: 1,
    freeRetries: 0,
    experimental: false,
    firstSeenPass: 1,
    history: [],
    createdAt: '2026-07-15T00:00:00.000Z',
  };
}

describe('classifyIteration (design doc §2)', () => {
  it('CLEARED: all targeted RESOLVED, no new findings', () => {
    expect(
      classifyIteration({
        targeted: [{ fingerprint: 'a', outcome: 'RESOLVED' }],
        newFindingsOpened: 0,
        regressedCount: 0,
      }),
    ).toBe('CLEARED');
  });

  it('CLEARED: nothing targeted and nothing new (steady state)', () => {
    expect(
      classifyIteration({ targeted: [], newFindingsOpened: 0, regressedCount: 0 }),
    ).toBe('CLEARED');
  });

  it('PROGRESSED: all priors RESOLVED, but new findings opened', () => {
    expect(
      classifyIteration({
        targeted: [
          { fingerprint: 'a', outcome: 'RESOLVED' },
          { fingerprint: 'b', outcome: 'RESOLVED' },
        ],
        newFindingsOpened: 9,
        regressedCount: 0,
      }),
    ).toBe('PROGRESSED');
  });

  it('STALLED: >=1 finding STILL-PRESENT and none resolved', () => {
    expect(
      classifyIteration({
        targeted: [{ fingerprint: 'a', outcome: 'STILL_PRESENT' }],
        newFindingsOpened: 0,
        regressedCount: 0,
      }),
    ).toBe('STALLED');
  });

  it('MIXED: some resolved, some still-present', () => {
    expect(
      classifyIteration({
        targeted: [
          { fingerprint: 'a', outcome: 'RESOLVED' },
          { fingerprint: 'b', outcome: 'STILL_PRESENT' },
        ],
        newFindingsOpened: 2,
        regressedCount: 0,
      }),
    ).toBe('MIXED');
  });

  it('OSCILLATING: any RESOLVED finding reappears, regardless of everything else', () => {
    expect(
      classifyIteration({
        targeted: [{ fingerprint: 'a', outcome: 'RESOLVED' }],
        newFindingsOpened: 0,
        regressedCount: 1,
      }),
    ).toBe('OSCILLATING');
  });
});

describe('classifySubjectiveScore / classifyReviewSignal — asymmetric threshold (US-410 AC-2)', () => {
  it('>=7 accepts, 5-6 requests bounded polish, 1-4 escalates to the human', () => {
    expect(classifySubjectiveScore(10)).toBe('ACCEPT');
    expect(classifySubjectiveScore(7)).toBe('ACCEPT');
    expect(classifySubjectiveScore(6)).toBe('BOUNDED_POLISH');
    expect(classifySubjectiveScore(5)).toBe('BOUNDED_POLISH');
    expect(classifySubjectiveScore(4)).toBe('ESCALATE_TO_HUMAN');
    expect(classifySubjectiveScore(1)).toBe('ESCALATE_TO_HUMAN');
  });

  it('rejects out-of-range or non-integer scores', () => {
    expect(() => classifySubjectiveScore(0)).toThrow(RangeError);
    expect(() => classifySubjectiveScore(11)).toThrow(RangeError);
    expect(() => classifySubjectiveScore(5.5)).toThrow(RangeError);
  });

  it('FR-L6 asymmetry: a score of 3 over a green deterministic gate emits an escalation card, not a failure', () => {
    const action = classifyReviewSignal({
      subjectiveScore: 3,
      deterministicGatePassed: true,
    });
    expect(action).toBe('ESCALATE_TO_HUMAN');
  });

  it('never auto-fails a passing deterministic gate — the return type has no FAIL variant', () => {
    for (let score = 1; score <= 10; score += 1) {
      const action = classifyReviewSignal({
        subjectiveScore: score,
        deterministicGatePassed: true,
      });
      expect(['ACCEPT', 'BOUNDED_POLISH', 'ESCALATE_TO_HUMAN']).toContain(action);
    }
  });

  it('refuses to be used as a substitute for the finding ledger on a failing deterministic gate', () => {
    expect(() =>
      classifyReviewSignal({ subjectiveScore: 8, deterministicGatePassed: false }),
    ).toThrow(/deterministic gate has not passed/);
  });
});

describe('FR-L7 §4 row 1/2: stall budget — 2 same-tier attempts then escalate, +1 post-escalation then BLOCK', () => {
  it('the third same-tier attempt at the same finding is always wrong: 1st retries, 2nd escalates, 3rd blocks', () => {
    const tracker = createFindingBudgetTracker();
    const first = tracker.evaluate('f1', 'STILL_PRESENT');
    expect(first).toEqual({ action: 'RETRY_SAME_TIER', attemptsAtTier: 1 });

    const second = tracker.evaluate('f1', 'STILL_PRESENT');
    expect(second).toEqual({ action: 'ESCALATE', reason: 'stall', attemptsAtTier: 2 });

    const third = tracker.evaluate('f1', 'STILL_PRESENT');
    expect(third.action).toBe('BLOCK');
    expect(third.reason).toBe('post_escalation_stall');
  });

  it("RESOLVED clears the finding's budget entry entirely", () => {
    const tracker = createFindingBudgetTracker();
    tracker.evaluate('f1', 'STILL_PRESENT');
    expect(tracker.peek('f1')).toBeDefined();
    const cleared = tracker.evaluate('f1', 'RESOLVED');
    expect(cleared).toEqual({ action: 'CLEARED', attemptsAtTier: 0 });
    expect(tracker.peek('f1')).toBeUndefined();

    // A fresh cycle after resolution starts the 2-strike budget over, not mid-escalation.
    const retried = tracker.evaluate('f1', 'STILL_PRESENT');
    expect(retried).toEqual({ action: 'RETRY_SAME_TIER', attemptsAtTier: 1 });
  });
});

describe('FR-L7 §3/§4 row 5: oscillation — REGRESSED escalates immediately, second blocks', () => {
  it('a REGRESSED finding escalates on the first occurrence', () => {
    const tracker = createFindingBudgetTracker();
    const decision = tracker.evaluate('f1', 'REGRESSED');
    expect(decision).toEqual({
      action: 'ESCALATE',
      reason: 'regression',
      attemptsAtTier: 0,
    });
  });

  it('a second REGRESSED for the same finding blocks — zero tolerance for oscillation', () => {
    const tracker = createFindingBudgetTracker();
    tracker.evaluate('f1', 'REGRESSED');
    const second = tracker.evaluate('f1', 'REGRESSED');
    expect(second.action).toBe('BLOCK');
    expect(second.reason).toBe('second_oscillation');
  });
});

describe('computeProgressCeiling / checkProgressCeiling — tier-aware ceiling (FINDING_LOOP_POLICY §3)', () => {
  it('caps at 8 on metered/frontier tiers regardless of points', () => {
    expect(computeProgressCeiling(1, 'metered')).toBe(4);
    expect(computeProgressCeiling(8, 'metered')).toBe(METERED_PROGRESS_CEILING_CAP);
    expect(computeProgressCeiling(20, 'metered')).toBe(METERED_PROGRESS_CEILING_CAP);
  });

  it('floors at 12+ on local/owned-hardware tiers, rising with points past the floor', () => {
    expect(computeProgressCeiling(1, 'local')).toBe(LOCAL_PROGRESS_CEILING_FLOOR);
    expect(computeProgressCeiling(20, 'local')).toBe(23);
  });

  it('tier fixture: identical points hit ceiling 8 on a metered tier and keep looping past 8 on a local tier', () => {
    const metered = checkProgressCeiling(8, 5, 'metered');
    expect(metered).toEqual({ ceiling: 8, action: 'PARK' });
    const local = checkProgressCeiling(8, 5, 'local');
    expect(local).toEqual({ ceiling: 12, action: 'CONTINUE' });
  });
});

describe('checkConvergence — sliding 2-pass window', () => {
  function entry(
    pass: number,
    openCount: number,
    iterationClass: PassOpenCount['iterationClass'],
  ): PassOpenCount {
    return { pass, openCount, iterationClass };
  }

  it('CONVERGING with fewer than 2 data points', () => {
    expect(checkConvergence([])).toBe('CONVERGING');
    expect(checkConvergence([entry(1, 5, 'STALLED')])).toBe('CONVERGING');
  });

  it('CONVERGING when open count strictly decreases', () => {
    const history = [entry(1, 5, 'MIXED'), entry(2, 3, 'MIXED')];
    expect(checkConvergence(history)).toBe('CONVERGING');
  });

  it('CONVERGING when the current pass is PROGRESSED, even if the count did not decrease', () => {
    const history = [entry(1, 2, 'PROGRESSED'), entry(2, 9, 'PROGRESSED')];
    expect(checkConvergence(history)).toBe('CONVERGING');
  });

  it('DIVERGED: two consecutive passes with a flat (non-decreasing) open count and no prior-resolutions', () => {
    const history = [entry(1, 5, 'STALLED'), entry(2, 5, 'STALLED')];
    expect(checkConvergence(history)).toBe('DIVERGED');
  });

  it('DIVERGED when the open count rises without PROGRESSED', () => {
    const history = [entry(1, 5, 'MIXED'), entry(2, 6, 'MIXED')];
    expect(checkConvergence(history)).toBe('DIVERGED');
  });
});

describe('createLoopConvergenceTracker — combined per-pass policy decision', () => {
  it('CLEARED when nothing targeted resolves and nothing new opens', () => {
    const tracker = createLoopConvergenceTracker();
    const action = tracker.recordPass({
      pass: 1,
      newFindingsOpened: 0,
      regressedFindings: [],
      recheckedFindings: [],
      openFindingsCount: 0,
      ticketPoints: 3,
      tier: 'metered',
    });
    expect(action).toEqual({ kind: 'CLEARED', pass: 1, iterationClass: 'CLEARED' });
  });

  it('never kills a loop that is still resolving priors just because new findings appeared', () => {
    // "2 -> 9 -> 15 discovering loop": priors resolve each pass while the reviewer digs deeper.
    const tracker = createLoopConvergenceTracker();
    const findingsByPass = [2, 9, 15].map((n, passIdx) =>
      Array.from({ length: n }, (_, i) => stubFinding(`p${passIdx}-${i}`)),
    );

    // Pass 1: 2 brand-new findings, nothing targeted yet.
    const pass1 = tracker.recordPass({
      pass: 1,
      newFindingsOpened: 2,
      regressedFindings: [],
      recheckedFindings: [],
      openFindingsCount: 2,
      ticketPoints: 20,
      tier: 'local',
    });
    expect(pass1.kind).toBe('CONTINUE');
    expect(pass1.iterationClass).toBe('PROGRESSED');

    // Pass 2: the 2 priors resolve, 9 new ones surface.
    const pass2 = tracker.recordPass({
      pass: 2,
      newFindingsOpened: 9,
      regressedFindings: [],
      recheckedFindings: findingsByPass[0]!.map((finding) => ({
        finding,
        outcome: 'RESOLVED' as const,
      })),
      openFindingsCount: 9,
      ticketPoints: 20,
      tier: 'local',
    });
    expect(pass2.kind).toBe('CONTINUE');
    expect(pass2.iterationClass).toBe('PROGRESSED');

    // Pass 3: the 9 priors resolve, 15 new ones surface — still not killed.
    const pass3 = tracker.recordPass({
      pass: 3,
      newFindingsOpened: 15,
      regressedFindings: [],
      recheckedFindings: findingsByPass[1]!.map((finding) => ({
        finding,
        outcome: 'RESOLVED' as const,
      })),
      openFindingsCount: 15,
      ticketPoints: 20,
      tier: 'local',
    });
    expect(pass3.kind).toBe('CONTINUE');
    expect(pass3.iterationClass).toBe('PROGRESSED');
    expect(tracker.openCountHistory.map((h) => h.openCount)).toEqual([2, 9, 15]);
  });

  it('a flat open-count for 2 passes stops the loop (divergence)', () => {
    const tracker = createLoopConvergenceTracker();
    const a = stubFinding('a');
    const b = stubFinding('b');

    const pass1 = tracker.recordPass({
      pass: 1,
      newFindingsOpened: 2,
      regressedFindings: [],
      recheckedFindings: [],
      openFindingsCount: 2,
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass1.kind).toBe('CONTINUE');

    // Pass 2: both targeted, both STILL_PRESENT (first strike each — no per-finding escalation
    // yet), and the open count stays flat at 2.
    const pass2 = tracker.recordPass({
      pass: 2,
      newFindingsOpened: 0,
      regressedFindings: [],
      recheckedFindings: [
        { finding: a, outcome: 'STILL_PRESENT' },
        { finding: b, outcome: 'STILL_PRESENT' },
      ],
      openFindingsCount: 2,
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass2.kind).toBe('STOP_DIVERGED');
    expect(pass2.iterationClass).toBe('STALLED');
  });

  it('escalates a stalled finding on its 2nd same-tier STILL_PRESENT verdict, carrying the ledger', () => {
    const tracker = createLoopConvergenceTracker();
    const a = stubFinding('a');

    tracker.recordPass({
      pass: 1,
      newFindingsOpened: 1,
      regressedFindings: [],
      recheckedFindings: [],
      openFindingsCount: 1,
      ticketPoints: 5,
      tier: 'metered',
    });
    tracker.recordPass({
      pass: 2,
      newFindingsOpened: 0,
      regressedFindings: [],
      recheckedFindings: [{ finding: a, outcome: 'STILL_PRESENT' }],
      openFindingsCount: 1,
      ticketPoints: 5,
      tier: 'metered',
    });
    const pass3 = tracker.recordPass({
      pass: 3,
      newFindingsOpened: 0,
      regressedFindings: [],
      recheckedFindings: [{ finding: a, outcome: 'STILL_PRESENT' }],
      openFindingsCount: 1,
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass3.kind).toBe('ESCALATE');
    if (pass3.kind !== 'ESCALATE') throw new Error('unreachable');
    expect(pass3.reason).toBe('stall');
    expect(pass3.findings).toEqual([a]);

    const pass4 = tracker.recordPass({
      pass: 4,
      newFindingsOpened: 0,
      regressedFindings: [],
      recheckedFindings: [{ finding: a, outcome: 'STILL_PRESENT' }],
      openFindingsCount: 1,
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass4.kind).toBe('BLOCK');
    if (pass4.kind !== 'BLOCK') throw new Error('unreachable');
    expect(pass4.reason).toBe('post_escalation_stall');
    expect(pass4.findings).toEqual([a]);
  });

  it('REGRESSED escalates immediately; a second REGRESSED for the same finding blocks', () => {
    const tracker = createLoopConvergenceTracker();
    const a = stubFinding('a');

    const pass1 = tracker.recordPass({
      pass: 1,
      newFindingsOpened: 0,
      regressedFindings: [a],
      recheckedFindings: [],
      openFindingsCount: 1,
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass1.kind).toBe('ESCALATE');
    if (pass1.kind !== 'ESCALATE') throw new Error('unreachable');
    expect(pass1.reason).toBe('regression');

    const pass2 = tracker.recordPass({
      pass: 2,
      newFindingsOpened: 0,
      regressedFindings: [a],
      recheckedFindings: [],
      openFindingsCount: 1,
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass2.kind).toBe('BLOCK');
    if (pass2.kind !== 'BLOCK') throw new Error('unreachable');
    expect(pass2.reason).toBe('second_oscillation');
  });

  it('parks (not fails) a ticket that hits the ceiling while still PROGRESSED — a decomposition signal', () => {
    const tracker = createLoopConvergenceTracker();
    // points=1 -> metered ceiling = min(4, 8) = 4.
    for (let pass = 1; pass <= 3; pass += 1) {
      const action = tracker.recordPass({
        pass,
        newFindingsOpened: 1,
        regressedFindings: [],
        recheckedFindings: [],
        openFindingsCount: pass,
        ticketPoints: 1,
        tier: 'metered',
      });
      expect(action.kind).toBe('CONTINUE');
    }
    const pass4 = tracker.recordPass({
      pass: 4,
      newFindingsOpened: 1,
      regressedFindings: [],
      recheckedFindings: [],
      openFindingsCount: 4,
      ticketPoints: 1,
      tier: 'metered',
    });
    expect(pass4).toEqual({
      kind: 'PARK',
      pass: 4,
      iterationClass: 'PROGRESSED',
      reason: 'decomposition_signal',
      ceiling: 4,
    });
  });
});
