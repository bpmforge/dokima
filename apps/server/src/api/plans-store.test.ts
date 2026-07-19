import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLogReader } from '@shipwright/events';
import type { PlanEvaluationSnapshot } from '@shipwright/pipeline';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptPlanItem,
  dismissPlanItem,
  evaluatePlan,
  listPlanItems,
  verifyPlan,
} from './plans-store.js';
import { PlanStoreError } from './plans-types.js';
import {
  promoteRule,
  recordRuleOutcome,
  registerRule,
} from './server/rule-state-store.js';
import { stateDbPath } from './server/settings-db.js';
import { buildPlanEvaluationSnapshot } from '../scheduler/snapshot.js';

/** Flags 'R-DEMO' as a demotion-flagged `gate` rule via the real rule_state lifecycle (PC-005's live source, mirrors plan-scheduler.test.ts). */
async function seedDemotionFlaggedRule(projectDir: string): Promise<void> {
  await registerRule(projectDir, 'R-DEMO');
  await promoteRule(projectDir, 'R-DEMO'); // proposed -> shadow
  await promoteRule(projectDir, 'R-DEMO'); // shadow -> advisory
  for (let i = 0; i < 20; i += 1) {
    await recordRuleOutcome(projectDir, 'R-DEMO', false);
  }
  await promoteRule(projectDir, 'R-DEMO'); // advisory -> gate
  for (let i = 0; i < 21; i += 1) {
    await recordRuleOutcome(projectDir, 'R-DEMO', true); // trailing FP rate now > DEMOTION_FP_THRESHOLD
  }
}

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-plans-store-'));
}

function baselineSnapshot(
  overrides: Partial<{
    receipts: { staleCount: number };
    coverage: { requiredSkipped: number };
    tickets: { oscillatingCount: number; blockedWithEvidenceMaxAgeDays: number };
  }> = {},
): PlanEvaluationSnapshot {
  return {
    phase: null,
    receipts: { staleCount: 0, ...overrides.receipts },
    coverage: { requiredSkipped: 0, ...overrides.coverage },
    findings: { openCriticalUnwaived: 0 },
    rules: { fpHeavyCount: 0 },
    tickets: {
      oscillatingCount: 0,
      blockedWithEvidenceMaxAgeDays: 0,
      ...overrides.tickets,
    },
    spend: { thresholdBreachRepeatCount: 0 },
    gates: { missingRedFixtureCount: 0 },
    providers: { unverifiedTosCount: 0 },
    deliverables: { orphanedCount: 0 },
    planItems: { regressedCount: 0 },
    playbook: { staleEntryCount: 0 },
  };
}

function readNotifications(dir: string): { kind: string; tier: string; body: string }[] {
  const db = openEventLogReader(stateDbPath(dir));
  try {
    return db.prepare('SELECT kind, tier, body FROM notifications').all() as {
      kind: string;
      tier: string;
      body: string;
    }[];
  } finally {
    db.close();
  }
}

describe('plans store', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('evaluatePlan matches the real catalog and persists proposed items, idempotently per catalog id', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const snapshot = baselineSnapshot({ receipts: { staleCount: 2 } });

    const first = await evaluatePlan(dir, snapshot);
    expect(first.created.map((c) => c.id)).toContain('PC-001');
    const staleItem = first.created.find((c) => c.id === 'PC-001')!;
    expect(staleItem.state).toBe('proposed');
    expect(staleItem.recommendation).toContain('2');
    expect(staleItem.verifyCriterion).toBe('receipts.staleCount == 0');

    // Re-evaluating the same snapshot must not duplicate PC-001 (proposeFromMatches dedupes on catalogId).
    const second = await evaluatePlan(dir, snapshot);
    expect(second.created.map((c) => c.id)).not.toContain('PC-001');

    const { items, funnel } = await listPlanItems(dir);
    expect(items.filter((i) => i.id === 'PC-001')).toHaveLength(1);
    expect(funnel.rawFindings).toBeGreaterThanOrEqual(1);
    expect(funnel.planItems).toBe(items.length);
  });

  it('ranks by severity x leverage x staleness, deterministically (FR-PLAN2)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const snapshot = baselineSnapshot({
      receipts: { staleCount: 1 }, // PC-001 severity 4 leverage 3
      tickets: { oscillatingCount: 1, blockedWithEvidenceMaxAgeDays: 0 }, // PC-003 severity 3 leverage 3
    });
    await evaluatePlan(dir, snapshot);
    const { items } = await listPlanItems(dir);
    const ranks = items.map((i) => i.id);
    expect(ranks.indexOf('PC-001')).toBeLessThan(ranks.indexOf('PC-003'));
  });

  it('acceptPlanItem mints a board ticket the first time, carrying verify verbatim', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await evaluatePlan(dir, baselineSnapshot({ receipts: { staleCount: 3 } }));

    const { item, ticketCreated } = await acceptPlanItem(dir, 'PC-001', {
      lane: 'pipeline',
    });
    expect(item.state).toBe('accepted');
    expect(item.ticketId).toBe('PLAN-PC-001');
    expect(ticketCreated).toBe(true);
  });

  it('accept refuses an unknown item', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await expect(acceptPlanItem(dir, 'ghost', { lane: 'pipeline' })).rejects.toThrow(
      PlanStoreError,
    );
  });

  it('verifyPlan flips accepted -> done when satisfied, done -> regressed when a later snapshot violates it, and emits one Review-tier drift_report card with the criterion + evidence', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const violated = baselineSnapshot({ receipts: { staleCount: 2 } });
    const satisfied = baselineSnapshot({ receipts: { staleCount: 0 } });

    await evaluatePlan(dir, violated);
    await acceptPlanItem(dir, 'PC-001', { lane: 'pipeline' });

    const stillOpen = await verifyPlan(dir, violated);
    expect(stillOpen.verified.find((i) => i.id === 'PC-001')?.state).toBe('accepted');

    const nowDone = await verifyPlan(dir, satisfied);
    expect(nowDone.verified.find((i) => i.id === 'PC-001')?.state).toBe('done');

    const regressedRun = await verifyPlan(dir, violated);
    const regressedItem = regressedRun.regressed.find((i) => i.id === 'PC-001');
    expect(regressedItem?.state).toBe('regressed');
    expect(regressedItem?.evidence).toMatchObject({ 'receipts.staleCount': 2 });

    // emitReviewItem always coalesces into one open `kind: 'digest'` row
    // (tier: 'review' always batches, emit-route.ts) — the per-item
    // `drift_report` kind lives inside body.items[], not the row itself.
    const notifications = readNotifications(dir);
    const digestCards = notifications.filter((n) => n.kind === 'digest');
    expect(digestCards).toHaveLength(1);
    expect(digestCards[0]?.tier).toBe('review');
    const body = JSON.parse(digestCards[0]!.body) as {
      items: { kind: string; title: string; summary: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.kind).toBe('drift_report');
    expect(body.items[0]?.title).toContain('PC-001');
    expect(body.items[0]?.summary).toContain('receipts.staleCount == 0');
    expect(body.items[0]?.summary).toContain('staleCount=2');
  });

  it(
    'SECURITY (CRITICAL, SC-03/law 4): verifyPlan driven by the real ' +
      "buildPlanEvaluationSnapshot derivation (the route's actual path) leaves an item " +
      'unsatisfied by real state alone, even though a fabricated snapshot claiming it ' +
      'satisfied would flip the identical item to done — closes the plans-store copy',
    async () => {
      async function seedAcceptedFpHeavyItem(): Promise<string> {
        const dir = await tmpProjectDir();
        dirs.push(dir);
        await seedDemotionFlaggedRule(dir);
        await evaluatePlan(dir, { ...baselineSnapshot(), rules: { fpHeavyCount: 1 } });
        await acceptPlanItem(dir, 'PC-005', { lane: 'pipeline' });
        return dir;
      }

      // Control: a caller-fabricated `rules.fpHeavyCount: 0` — exactly what
      // the pre-fix /plan/verify route trusted verbatim — flips PC-005 to
      // `done` with zero correlation to the real gate-demoted rule sitting
      // in `rule_state`. This demonstrates the primitive is real, not just
      // theoretical.
      const fabricatedDir = await seedAcceptedFpHeavyItem();
      const fabricatedSatisfied = { ...baselineSnapshot(), rules: { fpHeavyCount: 0 } };
      const fromFabricated = await verifyPlan(fabricatedDir, fabricatedSatisfied);
      expect(fromFabricated.verified.find((i) => i.id === 'PC-005')?.state).toBe('done');

      // The route's actual, fixed path: derive the snapshot from real state
      // and verify against THAT. Real state still has the demotion-flagged
      // rule, so the identically-seeded item stays open — no caller input
      // involved at all.
      const realDir = await seedAcceptedFpHeavyItem();
      const realSnapshot = await buildPlanEvaluationSnapshot(realDir);
      expect(realSnapshot.rules.fpHeavyCount).toBe(1);
      const fromReal = await verifyPlan(realDir, realSnapshot);
      expect(fromReal.verified.find((i) => i.id === 'PC-005')?.state).toBe('accepted');
    },
  );

  it('re-accepting a regressed item reuses its ticket (no duplicate mint) and bumps attempt', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const violated = baselineSnapshot({ receipts: { staleCount: 1 } });
    const satisfied = baselineSnapshot({ receipts: { staleCount: 0 } });

    await evaluatePlan(dir, violated);
    await acceptPlanItem(dir, 'PC-001', { lane: 'pipeline' });
    await verifyPlan(dir, satisfied);
    await verifyPlan(dir, violated);

    const { item, ticketCreated } = await acceptPlanItem(dir, 'PC-001', {
      lane: 'pipeline',
    });
    expect(item.state).toBe('accepted');
    expect(item.ticketId).toBe('PLAN-PC-001');
    expect(item.attempt).toBe(1);
    expect(ticketCreated).toBe(false);
  });

  it('dismissPlanItem soft-deletes a proposed item: excluded from the active list, still counted in rawFindings', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await evaluatePlan(
      dir,
      baselineSnapshot({
        tickets: { oscillatingCount: 1, blockedWithEvidenceMaxAgeDays: 0 },
      }),
    );

    const dismissed = await dismissPlanItem(dir, 'PC-003', 'not applicable to this repo');
    expect(dismissed.dismissedAt).not.toBeNull();
    expect(dismissed.dismissedReason).toBe('not applicable to this repo');

    const { items, funnel } = await listPlanItems(dir);
    expect(items.find((i) => i.id === 'PC-003')).toBeUndefined();
    expect(funnel.rawFindings).toBe(1);
    expect(funnel.planItems).toBe(0);

    const withDismissed = await listPlanItems(dir, { includeDismissed: true });
    expect(withDismissed.items.find((i) => i.id === 'PC-003')).toBeDefined();
  });

  it('dismiss refuses a non-proposed item (only proposed dismisses, per the design diagram)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await evaluatePlan(dir, baselineSnapshot({ receipts: { staleCount: 1 } }));
    await acceptPlanItem(dir, 'PC-001', { lane: 'pipeline' });
    await expect(dismissPlanItem(dir, 'PC-001', 'nope')).rejects.toThrow(PlanStoreError);
  });

  it('dismiss refuses an unknown item', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await expect(dismissPlanItem(dir, 'ghost', 'note')).rejects.toThrow(PlanStoreError);
  });
});
