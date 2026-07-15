import { describe, expect, it } from 'vitest';
import {
  createFindingLedger,
  type FindingLedger,
  type RawFinding,
  type RerunEvidence,
} from '../src/findings.js';
import { createLoopConvergenceTracker } from '../src/loop-policy.js';

/**
 * End-to-end fixtures for FR-L7 / FINDING_LOOP_POLICY.md §3-4, wired through the real
 * FindingLedger (not hand-built stub records) plus the real LoopConvergenceTracker — the two
 * acceptance scenarios ticket W3-08 names explicitly: a discovering loop whose open count goes
 * 2 -> 9 -> 15 must not be killed while every prior resolves, and a loop whose open count goes
 * flat for two passes must stop.
 */

const RERUN: RerunEvidence = {
  command: 'pnpm test -- --coverage',
  counts: { passed: 40, failed: 0 },
  exitCode: 0,
};

function highFindings(count: number, prefix: string): RawFinding[] {
  return Array.from({ length: count }, (_, i) => ({
    file: `src/module-${prefix}.ts`,
    category: 'correctness',
    issue: `${prefix} issue #${i}`,
    severity: 'HIGH' as const,
  }));
}

function openCount(ledger: FindingLedger): number {
  return ledger.findings.filter(
    (f) => f.state === 'OPEN' || f.state === 'FIX_ATTEMPTED' || f.state === 'REGRESSED',
  ).length;
}

describe('FR-L7 fixture: 2 -> 9 -> 15 discovering loop is not killed while priors resolve', () => {
  it('stays CONTINUE across three PROGRESSED passes on a local tier with headroom', () => {
    const ledger = createFindingLedger('W3-08-fixture');
    const tracker = createLoopConvergenceTracker();

    // Pass 1: reviewer finds 2 issues; nothing has been targeted for a fix yet.
    const pass1Report = ledger.reportPass(highFindings(2, 'p1'), 1);
    const pass1 = tracker.recordPass({
      pass: 1,
      newFindingsOpened: pass1Report.newFindings.length,
      regressedFindings: pass1Report.regressedFindings,
      recheckedFindings: [],
      openFindingsCount: openCount(ledger),
      ticketPoints: 20,
      tier: 'local',
    });
    expect(pass1.kind).toBe('CONTINUE');
    expect(pass1.iterationClass).toBe('PROGRESSED');

    // Pass 2: the coder fixes both; independent re-run confirms RESOLVED. The reviewer, now
    // seeing past the fixed code, surfaces 9 new issues (design doc §0: "the reviewer
    // discovering more as the work got more complete").
    const pass1Rechecks = pass1Report.newFindings.map((finding) =>
      ledger.recheck({
        fingerprint: finding.fingerprint,
        pass: 2,
        outcome: 'RESOLVED',
        rerun: RERUN,
      }),
    );
    const pass2Report = ledger.reportPass(highFindings(9, 'p2'), 2);
    const pass2 = tracker.recordPass({
      pass: 2,
      newFindingsOpened: pass2Report.newFindings.length,
      regressedFindings: pass2Report.regressedFindings,
      recheckedFindings: pass1Rechecks
        .filter((r) => r.status === 'RECORDED')
        .map((r) => ({ finding: r.finding, outcome: 'RESOLVED' as const })),
      openFindingsCount: openCount(ledger),
      ticketPoints: 20,
      tier: 'local',
    });
    expect(pass2.kind).toBe('CONTINUE');
    expect(pass2.iterationClass).toBe('PROGRESSED');

    // Pass 3: same story — 9 priors resolve, 15 new surface. Still not killed.
    const pass2Rechecks = pass2Report.newFindings.map((finding) =>
      ledger.recheck({
        fingerprint: finding.fingerprint,
        pass: 3,
        outcome: 'RESOLVED',
        rerun: RERUN,
      }),
    );
    const pass3Report = ledger.reportPass(highFindings(15, 'p3'), 3);
    const pass3 = tracker.recordPass({
      pass: 3,
      newFindingsOpened: pass3Report.newFindings.length,
      regressedFindings: pass3Report.regressedFindings,
      recheckedFindings: pass2Rechecks
        .filter((r) => r.status === 'RECORDED')
        .map((r) => ({ finding: r.finding, outcome: 'RESOLVED' as const })),
      openFindingsCount: openCount(ledger),
      ticketPoints: 20,
      tier: 'local',
    });
    expect(pass3.kind).toBe('CONTINUE');
    expect(pass3.iterationClass).toBe('PROGRESSED');

    expect(tracker.openCountHistory.map((h) => h.openCount)).toEqual([2, 9, 15]);
    expect(tracker.passesUsed).toBe(3);
  });
});

describe('FR-L7 fixture: a flat open-count for 2 passes stops the loop', () => {
  it('reports STOP_DIVERGED once the open count fails to decrease and no pass is PROGRESSED', () => {
    const ledger = createFindingLedger('W3-08-fixture-flat');
    const tracker = createLoopConvergenceTracker();

    const pass1Report = ledger.reportPass(highFindings(5, 'stall'), 1);
    const pass1 = tracker.recordPass({
      pass: 1,
      newFindingsOpened: pass1Report.newFindings.length,
      regressedFindings: [],
      recheckedFindings: [],
      openFindingsCount: openCount(ledger),
      ticketPoints: 5,
      tier: 'metered',
    });
    expect(pass1.kind).toBe('CONTINUE');
    expect(openCount(ledger)).toBe(5);

    // The coder attempts a fix for all 5; independent re-run says every single one is still
    // present, and no new issues surface — the open count stays flat at 5.
    const pass2Rechecks = pass1Report.newFindings.map((finding) =>
      ledger.recheck({
        fingerprint: finding.fingerprint,
        pass: 2,
        outcome: 'STILL_PRESENT',
        rerun: RERUN,
      }),
    );
    const pass2 = tracker.recordPass({
      pass: 2,
      newFindingsOpened: 0,
      regressedFindings: [],
      recheckedFindings: pass2Rechecks
        .filter((r) => r.status === 'RECORDED')
        .map((r) => ({ finding: r.finding, outcome: 'STILL_PRESENT' as const })),
      openFindingsCount: openCount(ledger),
      ticketPoints: 5,
      tier: 'metered',
    });

    expect(openCount(ledger)).toBe(5);
    expect(pass2.kind).toBe('STOP_DIVERGED');
    expect(pass2.iterationClass).toBe('STALLED');
  });
});
