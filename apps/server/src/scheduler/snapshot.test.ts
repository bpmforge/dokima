import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  promoteRule,
  recordRuleOutcome,
  registerRule,
} from '../api/server/rule-state-store.js';
import {
  buildPlanEvaluationSnapshot,
  LIVE_SNAPSHOT_PATHS,
  referencedSnapshotPaths,
  unresolvedSnapshotPaths,
} from './snapshot.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-snapshot-'));
}

describe('buildPlanEvaluationSnapshot', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('zero-fills every field for a project with no live producers wired yet', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const snapshot = await buildPlanEvaluationSnapshot(dir);
    expect(snapshot).toEqual({
      phase: null,
      receipts: { staleCount: 0 },
      coverage: { requiredSkipped: 0 },
      findings: { openCriticalUnwaived: 0 },
      rules: { fpHeavyCount: 0 },
      tickets: { oscillatingCount: 0, blockedWithEvidenceMaxAgeDays: 0 },
      spend: { thresholdBreachRepeatCount: 0 },
      gates: { missingRedFixtureCount: 0 },
      providers: { unverifiedTosCount: 0 },
      deliverables: { orphanedCount: 0 },
      planItems: { regressedCount: 0 },
      playbook: { staleEntryCount: 0 },
    });
  });

  it('counts a real demotion-flagged gate rule (rule_state table) in rules.fpHeavyCount', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-DEMO');
    await promoteRule(dir, 'R-DEMO'); // proposed -> shadow
    await promoteRule(dir, 'R-DEMO'); // shadow -> advisory
    for (let i = 0; i < 20; i += 1) {
      await recordRuleOutcome(dir, 'R-DEMO', false); // 20 clean samples clears the gate criteria
    }
    await promoteRule(dir, 'R-DEMO'); // advisory -> gate
    for (let i = 0; i < 21; i += 1) {
      await recordRuleOutcome(dir, 'R-DEMO', true); // pushes trailing FP rate over DEMOTION_FP_THRESHOLD
    }

    const snapshot = await buildPlanEvaluationSnapshot(dir);
    expect(snapshot.rules.fpHeavyCount).toBe(1);
  });

  it('does not count a gate rule that is not demotion-flagged', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-CLEAN');
    await promoteRule(dir, 'R-CLEAN');
    await promoteRule(dir, 'R-CLEAN');
    for (let i = 0; i < 20; i += 1) {
      await recordRuleOutcome(dir, 'R-CLEAN', false);
    }
    await promoteRule(dir, 'R-CLEAN');

    const snapshot = await buildPlanEvaluationSnapshot(dir);
    expect(snapshot.rules.fpHeavyCount).toBe(0);
  });
});

describe('referencedSnapshotPaths / unresolvedSnapshotPaths', () => {
  it('extracts the single dot-path each real catalog verify criterion references', () => {
    expect(referencedSnapshotPaths('receipts.staleCount == 0')).toEqual([
      'receipts.staleCount',
    ]);
    expect(referencedSnapshotPaths('rules.fpHeavyCount == 0')).toEqual([
      'rules.fpHeavyCount',
    ]);
    expect(referencedSnapshotPaths('tickets.blockedWithEvidenceMaxAgeDays <= 3')).toEqual(
      ['tickets.blockedWithEvidenceMaxAgeDays'],
    );
  });

  it('ignores dotted-looking text inside quoted string literals', () => {
    expect(referencedSnapshotPaths("phase == 'a.b.c'")).toEqual([]);
  });

  it('finds every path in a compound expression, not just the leftmost', () => {
    expect(
      referencedSnapshotPaths('rules.fpHeavyCount > 0 && coverage.requiredSkipped > 0'),
    ).toEqual(['rules.fpHeavyCount', 'coverage.requiredSkipped']);
  });

  it('rules.fpHeavyCount and planItems.regressedCount resolve live; every other catalog field does not', () => {
    expect(unresolvedSnapshotPaths('rules.fpHeavyCount == 0')).toEqual([]);
    expect(unresolvedSnapshotPaths('planItems.regressedCount == 0')).toEqual([]);
    expect(unresolvedSnapshotPaths('receipts.staleCount == 0')).toEqual([
      'receipts.staleCount',
    ]);
    expect(unresolvedSnapshotPaths('findings.openCriticalUnwaived == 0')).toEqual([
      'findings.openCriticalUnwaived',
    ]);
    expect(unresolvedSnapshotPaths('coverage.requiredSkipped == 0')).toEqual([
      'coverage.requiredSkipped',
    ]);
    expect(unresolvedSnapshotPaths('tickets.oscillatingCount == 0')).toEqual([
      'tickets.oscillatingCount',
    ]);
    expect(unresolvedSnapshotPaths('spend.thresholdBreachRepeatCount == 0')).toEqual([
      'spend.thresholdBreachRepeatCount',
    ]);
    expect(unresolvedSnapshotPaths('gates.missingRedFixtureCount == 0')).toEqual([
      'gates.missingRedFixtureCount',
    ]);
    expect(unresolvedSnapshotPaths('providers.unverifiedTosCount == 0')).toEqual([
      'providers.unverifiedTosCount',
    ]);
    expect(unresolvedSnapshotPaths('deliverables.orphanedCount == 0')).toEqual([
      'deliverables.orphanedCount',
    ]);
    expect(unresolvedSnapshotPaths('playbook.staleEntryCount == 0')).toEqual([
      'playbook.staleEntryCount',
    ]);
  });

  it('LIVE_SNAPSHOT_PATHS documents exactly the two fields buildPlanEvaluationSnapshot derives live', () => {
    expect(LIVE_SNAPSHOT_PATHS).toEqual(
      new Set(['rules.fpHeavyCount', 'planItems.regressedCount']),
    );
  });
});
