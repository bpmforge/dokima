import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  promoteRule,
  recordRuleOutcome,
  registerRule,
} from '../api/server/rule-state-store.js';
import { buildPlanEvaluationSnapshot } from './snapshot.js';

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
