import { describe, expect, it } from 'vitest';
import {
  ActorAuthorizationError,
  DEMOTION_FP_THRESHOLD,
  FindingLedgerError,
  INFRA_FAILURE_KINDS,
  computeFindingFingerprint,
  computeFindingFunnel,
  createFindingLedger,
  createInfraFailureTracker,
  createRuleStateStore,
  formatRerunLine,
  type Actor,
  type RawFinding,
  type RerunEvidence,
} from './findings.js';

function clockFrom(start: number): () => string {
  let tick = start;
  return () => new Date(tick++).toISOString();
}

const HUMAN: Actor = { id: 'human:brad', kind: 'human' };
const MACHINE: Actor = { id: 'machine:coder', kind: 'machine' };

const RERUN: RerunEvidence = {
  command: 'pnpm test -- findings',
  counts: { passed: 12, failed: 0 },
  exitCode: 0,
};

function highFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    file: 'src/auth.ts',
    category: 'security',
    issue: 'SQL injection in login handler',
    severity: 'HIGH',
    ...overrides,
  };
}

describe('computeFindingFingerprint', () => {
  it('is stable across trivial whitespace/case differences in the issue text', () => {
    const a = computeFindingFingerprint('a.ts', 'security', '  SQL Injection   here  ');
    const b = computeFindingFingerprint('a.ts', 'security', 'sql injection here');
    expect(a).toBe(b);
  });

  it('changes when file, category, or issue changes', () => {
    const base = computeFindingFingerprint('a.ts', 'security', 'sql injection');
    expect(computeFindingFingerprint('b.ts', 'security', 'sql injection')).not.toBe(base);
    expect(computeFindingFingerprint('a.ts', 'perf', 'sql injection')).not.toBe(base);
    expect(computeFindingFingerprint('a.ts', 'security', 'xss')).not.toBe(base);
  });
});

describe('createFindingLedger reportPass — finding identity (FR-L6)', () => {
  it('opens a new OPEN finding on first sighting of a HIGH/CRITICAL finding', () => {
    const ledger = createFindingLedger('W3-08', { now: clockFrom(0) });
    const result = ledger.reportPass([highFinding()], 1);
    expect(result.newFindings).toHaveLength(1);
    const finding = result.newFindings[0]!;
    expect(finding.state).toBe('OPEN');
    expect(finding.attempts).toBe(0);
    expect(finding.firstSeenPass).toBe(1);
    expect(finding.id).toBe('F-W3-08-1');
    expect(finding.history).toEqual([
      { pass: 1, state: 'OPEN', evidence: 'first sighted at pass 1', rerun: null },
    ]);
  });

  it('never ledgers LOW/MEDIUM severity findings (design doc §1)', () => {
    const ledger = createFindingLedger('W3-08');
    const result = ledger.reportPass(
      [
        highFinding({ severity: 'LOW' }),
        highFinding({ severity: 'MEDIUM', issue: 'other' }),
      ],
      1,
    );
    expect(result.newFindings).toHaveLength(0);
    expect(ledger.findings).toHaveLength(0);
  });

  it('dedupes repeated raw findings by fingerprint across passes into stillPresentFingerprints', () => {
    const ledger = createFindingLedger('W3-08');
    ledger.reportPass([highFinding()], 1);
    const result = ledger.reportPass([highFinding()], 2);
    expect(result.newFindings).toHaveLength(0);
    expect(result.stillPresentFingerprints).toHaveLength(1);
    expect(ledger.findings).toHaveLength(1);
  });

  it('FR-L6: a resolved-then-reappearing finding transitions to REGRESSED', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    ledger.recheck({
      fingerprint: opened.fingerprint,
      pass: 2,
      outcome: 'RESOLVED',
      rerun: RERUN,
    });
    expect(ledger.get(opened.fingerprint)?.state).toBe('RESOLVED');

    const result = ledger.reportPass([highFinding()], 3);
    expect(result.regressedFindings).toHaveLength(1);
    expect(result.regressedFindings[0]!.state).toBe('REGRESSED');
    expect(ledger.get(opened.fingerprint)?.state).toBe('REGRESSED');
  });

  it('a suppressed finding reappearing in a raw pass stays SUPPRESSED (context-change is the only reopen path)', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    ledger.suppress(
      opened.fingerprint,
      'false_positive',
      HUMAN,
      'rule@1|filehash@1|deps@1',
      2,
    );
    const result = ledger.reportPass([highFinding()], 3);
    expect(result.newFindings).toHaveLength(0);
    expect(result.regressedFindings).toHaveLength(0);
    expect(ledger.get(opened.fingerprint)?.state).toBe('SUPPRESSED');
  });
});

describe('createFindingLedger recheck — verdict evidence (R-B2)', () => {
  it('FR-L6/R-B2: a verdict missing the re-run line is rejected as INCOMPLETE and does not count', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    const before = ledger.get(opened.fingerprint)!;

    const result = ledger.recheck({
      fingerprint: opened.fingerprint,
      pass: 2,
      outcome: 'STILL_PRESENT',
      rerun: null,
    });

    expect(result.status).toBe('INCOMPLETE');
    const after = ledger.get(opened.fingerprint)!;
    expect(after).toEqual(before); // zero ledger writes
    expect(after.attempts).toBe(0);
    expect(after.history).toHaveLength(1);
  });

  it('rejects INCOMPLETE when rerun evidence is present but malformed (empty command / non-integer exit)', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    const result = ledger.recheck({
      fingerprint: opened.fingerprint,
      pass: 2,
      outcome: 'RESOLVED',
      rerun: { command: '  ', counts: { passed: 1 }, exitCode: 0 },
    });
    expect(result.status).toBe('INCOMPLETE');
  });

  it("FR-L6: a STILL-PRESENT verdict increments only that finding's attempts", () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;

    const first = ledger.recheck({
      fingerprint: opened.fingerprint,
      pass: 2,
      outcome: 'STILL_PRESENT',
      rerun: RERUN,
    });
    expect(first.status).toBe('RECORDED');
    if (first.status !== 'RECORDED') throw new Error('unreachable');
    expect(first.finding.attempts).toBe(1);
    expect(first.finding.state).toBe('FIX_ATTEMPTED');
    expect(first.finding.history.at(-1)?.evidence).toContain(formatRerunLine(RERUN));

    const resolved = ledger.recheck({
      fingerprint: opened.fingerprint,
      pass: 3,
      outcome: 'RESOLVED',
      rerun: RERUN,
    });
    expect(resolved.status).toBe('RECORDED');
    if (resolved.status !== 'RECORDED') throw new Error('unreachable');
    // RESOLVED must not bump attempts — only STILL_PRESENT does (FR-L6 fixture).
    expect(resolved.finding.attempts).toBe(1);
    expect(resolved.finding.state).toBe('RESOLVED');
  });

  it('recheck() against an unknown fingerprint throws FindingLedgerError', () => {
    const ledger = createFindingLedger('W3-08');
    expect(() =>
      ledger.recheck({ fingerprint: 'nope', pass: 1, outcome: 'RESOLVED', rerun: RERUN }),
    ).toThrow(FindingLedgerError);
  });
});

describe('recordFindingInfraFailure — per-finding free retries (R-D2)', () => {
  it('bumps freeRetries only — never attempts, state, or history', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    const updated = ledger.recordFindingInfraFailure(opened.fingerprint, 2);
    expect(updated.freeRetries).toBe(1);
    expect(updated.attempts).toBe(0);
    expect(updated.state).toBe('OPEN');
    expect(updated.history).toHaveLength(1);
  });
});

describe('createInfraFailureTracker — whole-review infra taxonomy (R-D2)', () => {
  it(
    'exposes the explicit taxonomy: unparseable review, limit pause, watchdog ' +
      'kill, output-buffer overflow, endpoint failure',
    () => {
      // Pinned as a LIST on purpose: adding a kind is a decision about what
      // retries for free, and this assertion is what forces it to be made
      // deliberately. It caught W13-27's addition, which is the point.
      expect(INFRA_FAILURE_KINDS).toEqual([
        'unparseable_review',
        'limit_pause',
        'watchdog_kill',
        'output_buffer_overflow',
        'endpoint_failure',
      ]);
    },
  );

  it(
    'W13-27: an endpoint failure is infrastructure — it says nothing about ' +
      'whether the work was right, so it must not cost an attempt',
    () => {
      const tracker = createInfraFailureTracker();
      tracker.record('endpoint_failure');
      expect(tracker.total).toBe(1);
      expect(tracker.counts.endpoint_failure).toBe(1);
      // And it stays out of every other counter.
      expect(tracker.counts.unparseable_review).toBe(0);
    },
  );

  it('a truncated review triggers a free retry with zero ledger writes', () => {
    const ledger = createFindingLedger('W3-08');
    ledger.reportPass([highFinding()], 1);
    const before = ledger.findings;

    const tracker = createInfraFailureTracker();
    tracker.record('unparseable_review');
    tracker.record('limit_pause');
    tracker.record('unparseable_review');

    expect(tracker.total).toBe(3);
    expect(tracker.counts.unparseable_review).toBe(2);
    expect(tracker.counts.limit_pause).toBe(1);
    // The tracker is wholly independent of the ledger — no finding/state/attempt was touched.
    expect(ledger.findings).toEqual(before);
    expect(ledger.events).toHaveLength(1); // only the original finding.opened event
  });
});

describe('createRuleStateStore — rule lifecycle + FP bookkeeping (FR-RL1/2)', () => {
  it('registers a rule in "proposed" state', () => {
    const store = createRuleStateStore({ now: clockFrom(0) });
    const rule = store.register('no-console-log');
    expect(rule.state).toBe('proposed');
    expect(rule.fpRate).toBe(0);
  });

  it("FR-RL2: no machine actor can change a rule's state", () => {
    const store = createRuleStateStore();
    store.register('no-console-log');
    expect(() => store.transition('no-console-log', 'shadow', MACHINE)).toThrow(
      ActorAuthorizationError,
    );
    expect(() =>
      store.promote('no-console-log', MACHINE, { minSampleCount: 5, maxFpRate: 0.1 }),
    ).toThrow(ActorAuthorizationError);
  });

  it('FR-RL2: promotion is refused below the FP sample minimum, with the counts shown', () => {
    const store = createRuleStateStore();
    store.register('no-console-log');
    store.transition('no-console-log', 'shadow', HUMAN);
    store.recordOutcome('no-console-log', false);
    store.recordOutcome('no-console-log', false);

    expect(() =>
      store.promote('no-console-log', HUMAN, { minSampleCount: 5, maxFpRate: 0.5 }),
    ).toThrow(/2 findings observed, minimum 5 required/);
  });

  it('refuses promotion when the measured FP rate exceeds the class threshold', () => {
    const store = createRuleStateStore();
    store.register('no-console-log');
    store.transition('no-console-log', 'shadow', HUMAN);
    for (let i = 0; i < 5; i += 1) store.recordOutcome('no-console-log', true);

    expect(() =>
      store.promote('no-console-log', HUMAN, { minSampleCount: 5, maxFpRate: 0.1 }),
    ).toThrow(/FP rate/);
  });

  it('promotes shadow -> gate once sample minimum and FP threshold are satisfied', () => {
    const store = createRuleStateStore({ now: clockFrom(0) });
    store.register('no-console-log');
    store.transition('no-console-log', 'shadow', HUMAN);
    for (let i = 0; i < 5; i += 1) store.recordOutcome('no-console-log', false);

    const promoted = store.promote('no-console-log', HUMAN, {
      minSampleCount: 5,
      maxFpRate: 0.1,
    });
    expect(promoted.state).toBe('gate');
    expect(promoted.promotedAt).not.toBeNull();
  });

  it('injected FP history > 50% flags demotion within one evaluation cycle', () => {
    const store = createRuleStateStore();
    store.register('flaky-rule');
    store.transition('flaky-rule', 'shadow', HUMAN);
    for (let i = 0; i < 5; i += 1) store.recordOutcome('flaky-rule', false);
    store.promote('flaky-rule', HUMAN, { minSampleCount: 5, maxFpRate: 0.1 });

    expect(store.get('flaky-rule')?.demotionFlagged).toBe(false);
    store.recordOutcome('flaky-rule', true);
    store.recordOutcome('flaky-rule', true);
    store.recordOutcome('flaky-rule', true);
    store.recordOutcome('flaky-rule', true);
    // window is now 5 clean + 4 FP = 9 findings, 4 FP -> 44%, still under threshold
    expect(store.get('flaky-rule')?.demotionFlagged).toBe(false);
    store.recordOutcome('flaky-rule', true);
    // 5/10 = 50%, not yet > threshold
    expect(store.get('flaky-rule')?.demotionFlagged).toBe(false);
    store.recordOutcome('flaky-rule', true);
    // 6/11 > 50%
    expect(store.get('flaky-rule')?.demotionFlagged).toBe(true);
    expect(DEMOTION_FP_THRESHOLD).toBe(0.5);
  });
});

describe('shadow-rule findings — experimental stamping + gate exclusion (FR-RL1)', () => {
  it("a shadow rule's findings render stamped experimental and are excluded from the effective funnel", () => {
    const store = createRuleStateStore();
    store.register('shadow-rule');
    store.transition('shadow-rule', 'shadow', HUMAN);
    const ledger = createFindingLedger('W3-08', {
      resolveRuleState: (ruleId) => store.get(ruleId)?.state,
    });

    const result = ledger.reportPass(
      [
        highFinding({ ruleId: 'shadow-rule' }),
        highFinding({ ruleId: undefined, issue: 'other issue' }),
      ],
      1,
    );

    const shadowFinding = result.newFindings.find((f) => f.ruleId === 'shadow-rule')!;
    expect(shadowFinding.experimental).toBe(true);
    // 2 raw, 2 deduped, but only the non-shadow one is effective.
    expect(result.funnel).toEqual({ raw: 2, deduped: 2, effective: 1, suppressed: 0 });
  });
});

describe('suppressions (FR-RL3)', () => {
  it('rejects a machine-identity suppression attempt', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    expect(() =>
      ledger.suppress(opened.fingerprint, 'false_positive', MACHINE, 'ctx@1', 2),
    ).toThrow(ActorAuthorizationError);
  });

  it('requires a justification enum and human signature, and marks the finding SUPPRESSED', () => {
    const ledger = createFindingLedger('W3-08', { now: clockFrom(0) });
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    const suppression = ledger.suppress(
      opened.fingerprint,
      'accepted_risk',
      HUMAN,
      'rule@1|filehash@1|deps@1',
      2,
    );
    expect(suppression.status).toBe('active');
    expect(suppression.signedBy).toEqual(HUMAN);
    expect(ledger.get(opened.fingerprint)?.state).toBe('SUPPRESSED');
  });

  it('auto-reopens a suppressed finding when its context_key changes; no-ops when unchanged', () => {
    const ledger = createFindingLedger('W3-08');
    const opened = ledger.reportPass([highFinding()], 1).newFindings[0]!;
    ledger.suppress(
      opened.fingerprint,
      'wont_fix_documented',
      HUMAN,
      'rule@1|filehash@1|deps@1',
      2,
    );

    const unchanged = ledger.reopenIfContextChanged(
      opened.fingerprint,
      'rule@1|filehash@1|deps@1',
      3,
    );
    expect(unchanged.status).toBe('active');
    expect(ledger.get(opened.fingerprint)?.state).toBe('SUPPRESSED');

    const reopened = ledger.reopenIfContextChanged(
      opened.fingerprint,
      'rule@1|filehash@2|deps@1',
      4,
    );
    expect(reopened.status).toBe('reopened');
    expect(ledger.get(opened.fingerprint)?.state).toBe('OPEN');
  });
});

describe('FR-RL4: funnel counts raw/deduped/effective/suppressed', () => {
  it('every gate summary shows raw -> deduped -> effective -> suppressed', () => {
    const ledger = createFindingLedger('W3-08');
    const findings = Array.from({ length: 10 }, (_, i) =>
      highFinding({ issue: `issue #${i}` }),
    );
    const pass1 = ledger.reportPass(findings, 1);
    expect(pass1.funnel).toEqual({ raw: 10, deduped: 10, effective: 10, suppressed: 0 });

    // Suppress 3, resolve 4 with evidence, leave 3 open -> effective should reflect only open ones.
    for (let i = 0; i < 3; i += 1) {
      ledger.suppress(
        pass1.newFindings[i]!.fingerprint,
        'not_applicable_scope',
        HUMAN,
        'ctx',
        2,
      );
    }
    for (let i = 3; i < 7; i += 1) {
      ledger.recheck({
        fingerprint: pass1.newFindings[i]!.fingerprint,
        pass: 2,
        outcome: 'RESOLVED',
        rerun: RERUN,
      });
    }
    const funnel = computeFindingFunnel(ledger);
    expect(funnel).toEqual({ raw: 10, deduped: 10, effective: 3, suppressed: 3 });
  });
});
