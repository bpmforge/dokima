import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentity, openEventLog, openEventLogReader } from '@shipwright/events';
import { completeRun, createRun } from '@shipwright/harbormaster';
import { afterEach, describe, expect, it } from 'vitest';
import { acceptPlanItem, listPlanItems } from '../api/plans-store.js';
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

async function tmpFleetHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-plan-scheduler-'));
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
  const dbPath = path.join(projectDir, '.shipwright', 'state.db');
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(errorCount).toBeGreaterThan(0);

    handle.stop();
    const countAtStop = errorCount;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(errorCount).toBe(countAtStop);
  });
});
