import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentity, openEventLog, openEventLogReader } from '@dokima/events';
import { completeRun, createRun } from '@dokima/harbormaster';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptPlanItem,
  evaluatePlan,
  listPlanItems,
  verifyPlan,
} from '../api/plans-store.js';
import { computeFleetRegistryPath, registerProject } from '../api/projects.js';
import {
  promoteRule,
  recordRuleOutcome,
  registerRule,
} from '../api/server/rule-state-store.js';
import { stateDbPath } from '../api/server/settings-db.js';
import {
  pollRunCompletions,
  runNightlyVerify,
  startPlanScheduler,
} from './plan-scheduler.js';

vi.mock('../api/plans-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/plans-store.js')>();
  return {
    ...actual,
    evaluatePlan: vi.fn(actual.evaluatePlan),
    verifyPlan: vi.fn(actual.verifyPlan),
  };
});

async function tmpFleetHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dokima-plan-scheduler-'));
}

/** Flags 'R-DEMO' as a demotion-flagged `gate` rule via the real rule_state lifecycle (PC-005's live source). */
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

async function appendRunEvent(
  projectDir: string,
  mode: 'improve' | 'feature',
  complete: boolean,
): Promise<void> {
  const dbPath = path.join(projectDir, '.dokima', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const log = openEventLog(dbPath);
  try {
    createIdentity(log, { id: 'human-1', name: 'Test Human', kind: 'human' });
    createRun(log, {
      id: `run-${mode}-${complete ? 'done' : 'live'}`,
      projectId: 'proj-1',
      mode,
      breakpoint: 'ticket',
      actorId: 'human-1',
    });
    if (complete) {
      completeRun(log, `run-${mode}-${complete ? 'done' : 'live'}`, 'human-1');
    }
  } finally {
    log.close();
  }
}

function readNotifications(
  projectDir: string,
): { kind: string; tier: string; body: string }[] {
  const db = openEventLogReader(stateDbPath(projectDir));
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

describe('pollRunCompletions', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('a completed run triggers the real catalog engine end-to-end: demotion-flagged rule -> PC-005 proposed + persisted', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-a');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);
    await appendRunEvent(projectDir, 'feature', true);

    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);

    const { items } = await listPlanItems(projectDir);
    const pc005 = items.find((i) => i.catalogId === 'PC-005');
    expect(pc005).toBeDefined();
    expect(pc005?.state).toBe('proposed');
    expect(pc005?.recommendation).toContain('1');
  });

  it('an Improve-mode run.created (no completion) also triggers evaluation', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-b');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);
    await appendRunEvent(projectDir, 'improve', false);

    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);

    const { items } = await listPlanItems(projectDir);
    expect(items.some((i) => i.catalogId === 'PC-005')).toBe(true);
  });

  it('does not re-propose on a second poll with no new trigger events (cursor advances, engine stays idempotent)', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-c');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);
    await appendRunEvent(projectDir, 'feature', true);

    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);
    await pollRunCompletions(fleetHome, cursors);
    await pollRunCompletions(fleetHome, cursors);

    const { items } = await listPlanItems(projectDir);
    expect(items.filter((i) => i.catalogId === 'PC-005')).toHaveLength(1);
  });

  it('a project with no run events yet proposes nothing', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-d');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);

    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);

    const { items } = await listPlanItems(projectDir);
    expect(items).toHaveLength(0);
  });

  it('one project failing evaluatePlan does not sink the others, and its cursor is not advanced past the trigger', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectFail = path.join(fleetHome, 'project-fail');
    const projectOk = path.join(fleetHome, 'project-ok');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectFail,
      mode: 'new',
    });
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectOk,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectFail);
    await seedDemotionFlaggedRule(projectOk);
    await appendRunEvent(projectFail, 'feature', true);
    await appendRunEvent(projectOk, 'feature', true);

    vi.mocked(evaluatePlan).mockRejectedValueOnce(new Error('boom'));

    const cursors = new Map<string, number>();
    const errors: { projectPath: string; err: unknown }[] = [];
    await pollRunCompletions(fleetHome, cursors, {
      onError: (projectPath, err) => errors.push({ projectPath, err }),
    });

    expect(errors).toEqual([{ projectPath: projectFail, err: new Error('boom') }]);

    // project-ok still processed despite project-fail throwing first.
    const { items: okItems } = await listPlanItems(projectOk);
    expect(okItems.some((i) => i.catalogId === 'PC-005')).toBe(true);

    // project-fail's rejected pass created nothing (transaction never opened).
    const { items: failItemsAfterError } = await listPlanItems(projectFail);
    expect(failItemsAfterError).toHaveLength(0);

    // A second poll retries project-fail — its cursor never advanced past
    // the trigger event the failed pass saw.
    await pollRunCompletions(fleetHome, cursors);
    const { items: failItemsAfterRetry } = await listPlanItems(projectFail);
    expect(failItemsAfterRetry.some((i) => i.catalogId === 'PC-005')).toBe(true);
  });
});

describe('runNightlyVerify', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('flips an accepted item to done, then to regressed on a later violating snapshot, emitting one Review-tier notification and zero new tickets', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-e');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);
    await appendRunEvent(projectDir, 'feature', true);

    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);
    const { items: proposed } = await listPlanItems(projectDir);
    const pc005 = proposed.find((i) => i.catalogId === 'PC-005')!;
    const { ticketCreated } = await acceptPlanItem(projectDir, pc005.id, {
      lane: 'trust',
    });
    expect(ticketCreated).toBe(true);

    // Dilutes the trailing FP rate back to exactly the threshold (not over
    // it), clearing the real demotion flag — rules.fpHeavyCount reads 0.
    await recordRuleOutcome(projectDir, 'R-DEMO', false);

    await runNightlyVerify(fleetHome);
    const { items: afterFirstVerify } = await listPlanItems(projectDir);
    expect(afterFirstVerify.find((i) => i.catalogId === 'PC-005')?.state).toBe('done');
    expect(readNotifications(projectDir)).toHaveLength(0);

    // Demotion flag returns (the rule regresses in the real rule_state table)
    // -> the same live snapshot now violates the criterion -> done -> regressed.
    for (let i = 0; i < 5; i += 1) {
      await recordRuleOutcome(projectDir, 'R-DEMO', true);
    }
    await runNightlyVerify(fleetHome);
    const { items: afterSecondVerify, funnel } = await listPlanItems(projectDir);
    const regressedItem = afterSecondVerify.find((i) => i.catalogId === 'PC-005');
    expect(regressedItem?.state).toBe('regressed');
    expect(funnel.regressed).toBe(1);

    const notifications = readNotifications(projectDir);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: 'digest', tier: 'review' });
    const body = JSON.parse(notifications[0]!.body) as {
      items: { kind: string; refId: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ kind: 'drift_report', refId: pc005.id });
  });

  it('never verifies a proposed (unaccepted) item — no auto-accept, no Decide-tier action', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-f');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);
    await appendRunEvent(projectDir, 'feature', true);

    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);

    await runNightlyVerify(fleetHome);

    const { items } = await listPlanItems(projectDir);
    const pc005 = items.find((i) => i.catalogId === 'PC-005');
    expect(pc005?.state).toBe('proposed');
    expect(pc005?.ticketId).toBeNull();
  });

  it('does not fake-satisfy an accepted item whose verify criterion has no live snapshot producer — skips instead of flipping to done', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-g');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });

    // PC-001 (receipts.staleCount) has no live producer in apps/server yet —
    // the only way it enters plan_items today is a caller-supplied snapshot
    // via the /plan/evaluate route (simulated here directly against the store).
    await evaluatePlan(projectDir, {
      phase: null,
      receipts: { staleCount: 3 },
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
    const { items: proposed } = await listPlanItems(projectDir);
    const pc001 = proposed.find((i) => i.catalogId === 'PC-001')!;
    expect(pc001).toBeDefined();
    await acceptPlanItem(projectDir, pc001.id, { lane: 'trust' });

    const skips: { projectPath: string; skipped: { catalogId: string }[] }[] = [];
    await runNightlyVerify(fleetHome, {
      onVerifySkipped: (projectPath, skipped) =>
        skips.push({ projectPath, skipped: [...skipped] }),
    });

    const { items: afterVerify } = await listPlanItems(projectDir);
    expect(afterVerify.find((i) => i.catalogId === 'PC-001')?.state).toBe('accepted');
    expect(readNotifications(projectDir)).toHaveLength(0);
    expect(skips).toHaveLength(1);
    expect(skips[0]?.projectPath).toBe(projectDir);
    expect(skips[0]?.skipped).toEqual([
      { catalogId: 'PC-001', unresolvedPaths: ['receipts.staleCount'] },
    ]);
  });

  it('one project failing verifyPlan does not sink the others', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectFail = path.join(fleetHome, 'project-h');
    const projectOk = path.join(fleetHome, 'project-i');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectFail,
      mode: 'new',
    });
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectOk,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectFail);
    await seedDemotionFlaggedRule(projectOk);
    await appendRunEvent(projectFail, 'feature', true);
    await appendRunEvent(projectOk, 'feature', true);
    const cursors = new Map<string, number>();
    await pollRunCompletions(fleetHome, cursors);
    for (const dir of [projectFail, projectOk]) {
      const { items } = await listPlanItems(dir);
      const pc005 = items.find((i) => i.catalogId === 'PC-005')!;
      await acceptPlanItem(dir, pc005.id, { lane: 'trust' });
    }
    // Clears the demotion flag (rules.fpHeavyCount -> 0) so projectOk's item
    // is genuinely verify-satisfied, isolating the assertion to "did the
    // other project's pass still run" rather than the FP-rate fixture.
    await recordRuleOutcome(projectOk, 'R-DEMO', false);

    vi.mocked(verifyPlan).mockRejectedValueOnce(new Error('boom'));

    const errors: { projectPath: string; err: unknown }[] = [];
    await runNightlyVerify(fleetHome, {
      onError: (projectPath, err) => errors.push({ projectPath, err }),
    });

    expect(errors).toEqual([{ projectPath: projectFail, err: new Error('boom') }]);
    const { items: okItems } = await listPlanItems(projectOk);
    expect(okItems.find((i) => i.catalogId === 'PC-005')?.state).toBe('done');
  });
});

describe('startPlanScheduler', () => {
  const dirs: string[] = [];
  let handle: ReturnType<typeof startPlanScheduler> | undefined;

  afterEach(async () => {
    handle?.stop();
    handle = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('fires pollRunCompletions on its own timer and proposes a real item', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    const projectDir = path.join(fleetHome, 'project-timer');
    await registerProject(computeFleetRegistryPath(fleetHome), {
      path: projectDir,
      mode: 'new',
    });
    await seedDemotionFlaggedRule(projectDir);
    await appendRunEvent(projectDir, 'feature', true);

    const errors: unknown[] = [];
    handle = startPlanScheduler({
      fleetHome,
      runCompletionPollMs: 10,
      nightlyIntervalMs: 3_600_000,
      onError: (_phase, err) => errors.push(err),
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(errors).toEqual([]);
    const { items } = await listPlanItems(projectDir);
    expect(items.some((i) => i.catalogId === 'PC-005')).toBe(true);
  });

  it('stop() clears both timers (no further passes after stopping)', async () => {
    const fleetHome = await tmpFleetHome();
    dirs.push(fleetHome);
    // fleet.json as a directory makes every listProjectCards() call reject
    // with a non-ENOENT error (EISDIR) — a reliable per-tick signal via
    // onError, without depending on wall-clock-sensitive content timing.
    await fs.mkdir(computeFleetRegistryPath(fleetHome));

    let errorCount = 0;
    handle = startPlanScheduler({
      fleetHome,
      runCompletionPollMs: 10,
      nightlyIntervalMs: 10,
      onError: () => {
        errorCount += 1;
      },
    });
    // Poll until the timers have fired at least once instead of gambling on a
    // fixed wall-clock wait — robust to machine load (the fixed 50ms sleep here
    // flaked under conductor load; L: timer tests must not assert on fixed sleeps).
    const deadline = Date.now() + 3000;
    while (errorCount === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(errorCount).toBeGreaterThan(0);

    handle.stop();
    // Let any poll already in flight at stop() settle before snapshotting, so a
    // late increment from an in-flight async pass can't be misattributed to a
    // post-stop fire.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const countAtStop = errorCount;
    // Generous window: with both intervals cleared, zero further fires must occur.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(errorCount).toBe(countAtStop);
  });
});
