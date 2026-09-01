/**
 * P6-05: per-feature landing wired through the REAL land loop — the park
 * after a close-gate-green ticket, the idle-time feature sweep, and the two
 * Challenger-lesson fixtures: parking is DURABLE (a restart neither
 * re-claims a parked ticket nor deletes its branch), and a park is not a
 * landing (an incomplete feature WAITS with its branches intact).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { branchNameFor, git } from '@dokima/git';
import type { SpawnSession } from '@dokima/loop';
import { createTicket, getTicket } from '@dokima/tickets';
import type { PushToRemotesFn } from './land-push.js';
import { defaultHandoffBuilder } from './loop-handoff.js';
import { runLandLoop, type LandLoopOptions } from './loop-land.js';
import {
  BRANCH_PARKED_EVENT,
  FEATURES_RECORDED_EVENT,
  parkedBranches,
  readBoardFeatures,
  type BoardFeature,
} from './loop-land-feature.js';
import { parkLandedTicketBranch } from './loop-land-feature-run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_VALIDATORS_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'content',
  'validators',
);

interface Fixture {
  repoRoot: string;
  log: EventLog;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-featrun-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-featrun-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  cleanups.push(async () => {
    log.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(dbDir, { recursive: true, force: true });
  });
  return { repoRoot, log };
}

function seedTicket(log: EventLog, id: string, dependsOn: string[] = []) {
  return createTicket(log, 'worker-1', {
    id,
    type: 'task',
    title: `Ticket ${id}`,
    lane: 'core',
    writeScope: ['packages/example/**'],
    dependsOn,
    verify: 'true',
  });
}

const unusedPushToRemotes: PushToRemotesFn = async () => {
  throw new Error('pushToRemotes invoked with no remotes configured on the fixture repo');
};

/** Commits one file NAMED FOR THE TICKET so two members merge cleanly. */
const perTicketSpawn: SpawnSession = async (input) => {
  const ticketId = path.basename(input.cwd);
  const rel = `packages/example/${ticketId.toLowerCase()}.ts`;
  const filePath = path.join(input.cwd, rel);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `export const from = '${ticketId}';\n`);
  await git(input.cwd, ['add', '--', rel]);
  await git(input.cwd, ['commit', '-m', `feat: ${ticketId}`]);
  const manifest = {
    ticket: ticketId,
    files: [rel],
    verify: { command: 'true', exit: 0 },
    commits: [],
    evidence: [],
  };
  return { stdout: JSON.stringify(manifest), stderr: '', exitCode: 0 };
};

function featureOptions(
  fixture: Fixture,
  features: readonly BoardFeature[],
): LandLoopOptions {
  return {
    log: fixture.log,
    actorId: 'worker-1',
    projectId: 'proj-p6-05',
    repoRoot: fixture.repoRoot,
    contentDir: CONTENT_VALIDATORS_DIR,
    signingKey: 'test-p6-05-signing-key',
    spawn: perTicketSpawn,
    pushToRemotes: unusedPushToRemotes,
    buildHandoff: defaultHandoffBuilder(),
    landing: 'per-feature',
    features,
    verifyFeature: async () => ({ green: true, detail: 'fake feature verify' }),
    now: () => '2026-08-31T00:00:00.000Z',
  };
}

describe('parkLandedTicketBranch', () => {
  it('records a durable park for a real branch, and comments instead when the branch is gone', async () => {
    const fixture = await setupFixture();
    const ticket = seedTicket(fixture.log, 'T-1');
    const branch = branchNameFor(ticket.id, ticket.title);
    const wt = path.join(fixture.repoRoot, '.dokima', 'worktrees', ticket.id);
    await git(fixture.repoRoot, ['worktree', 'add', '-b', branch, wt, 'main']);
    const head = (await git(wt, ['rev-parse', 'HEAD'])).stdout.trim();

    await parkLandedTicketBranch(featureOptions(fixture, []), ticket);
    expect(parkedBranches(fixture.log).get('T-1')).toEqual({
      ticketId: 'T-1',
      branch,
      headSha: head,
    });

    const orphan = seedTicket(fixture.log, 'T-2');
    await parkLandedTicketBranch(featureOptions(fixture, []), orphan);
    expect(parkedBranches(fixture.log).has('T-2')).toBe(false);
    const comment = getTicket(fixture.log, 'T-2')!.history.find(
      (h) => h.verb === 'comment',
    );
    expect(comment?.body).toContain('could not park');
  });
});

describe('runLandLoop with landing=per-feature', () => {
  vi.setConfig({ testTimeout: 60_000 });

  it('parks every green ticket, then lands the COMPLETE feature as one merge at idle (acceptance 1+2)', async () => {
    const fixture = await setupFixture();
    seedTicket(fixture.log, 'T-1');
    seedTicket(fixture.log, 'T-2');
    const features: BoardFeature[] = [{ id: 'F-auth', tickets: ['T-1', 'T-2'] }];
    const before = (await git(fixture.repoRoot, ['rev-parse', 'main'])).stdout.trim();

    const result = await runLandLoop(featureOptions(fixture, features));

    expect(result.stopReason).toBe('idle');
    // Both tickets checkpointed AND parked — a park, not a landing.
    for (const outcome of result.processed) {
      expect(outcome.landed).toBe(true);
      expect(outcome.parkedForFeatureLanding).toBe(true);
      expect(outcome.finalStatus).toBe('in_review');
    }
    const parkEvents = listEvents(fixture.log).filter(
      (e) => e.eventType === BRANCH_PARKED_EVENT,
    );
    expect(parkEvents.map((e) => e.ticketId)).toEqual(['T-1', 'T-2']);
    // The idle sweep landed the feature as ONE merge on main.
    expect(result.featureLandings).toHaveLength(1);
    expect(result.featureLandings![0]!).toMatchObject({
      featureId: 'F-auth',
      landed: true,
    });
    const after = (await git(fixture.repoRoot, ['rev-parse', 'main'])).stdout.trim();
    expect(after).not.toBe(before);
    expect((await git(fixture.repoRoot, ['rev-parse', 'main~1'])).stdout.trim()).toBe(
      before,
    );
    await expect(
      fs.readFile(path.join(fixture.repoRoot, 'packages/example/t-1.ts'), 'utf8'),
    ).resolves.toContain('T-1');
    await expect(
      fs.readFile(path.join(fixture.repoRoot, 'packages/example/t-2.ts'), 'utf8'),
    ).resolves.toContain('T-2');
    // The handed-in feature map was PERSISTED where the board rows live.
    expect(readBoardFeatures(fixture.log)).toEqual([
      { id: 'F-auth', tickets: ['T-1', 'T-2'] },
    ]);
    // Parks retired; statuses untouched by the landing (a human still accepts).
    expect(parkedBranches(fixture.log).size).toBe(0);
    expect(getTicket(fixture.log, 'T-1')!.status).toBe('in_review');
    expect(getTicket(fixture.log, 'T-2')!.status).toBe('in_review');
  });

  it('an INCOMPLETE feature waits, and a restart neither re-claims a parked ticket nor deletes its branch', async () => {
    const fixture = await setupFixture();
    seedTicket(fixture.log, 'T-1');
    // T-2 depends on a ticket that is not done, so it is not claimable yet:
    // the feature cannot complete this run.
    seedTicket(fixture.log, 'T-2', ['T-9-NEVER']);
    const features: BoardFeature[] = [{ id: 'F-auth', tickets: ['T-1', 'T-2'] }];
    const before = (await git(fixture.repoRoot, ['rev-parse', 'main'])).stdout.trim();

    const first = await runLandLoop(featureOptions(fixture, features));
    const waitingReport = first.featureLandings!.find((f) => f.featureId === 'F-auth');
    expect(waitingReport).toMatchObject({ landed: false });
    expect(waitingReport!.detail).toContain('waiting');
    // The park is real and the branch survives the refusal-to-land.
    const branch = branchNameFor('T-1', 'Ticket T-1');
    expect(parkedBranches(fixture.log).get('T-1')?.branch).toBe(branch);
    await git(fixture.repoRoot, ['rev-parse', '--verify', branch]);
    // Main untouched — a park is not a landing.
    expect((await git(fixture.repoRoot, ['rev-parse', 'main'])).stdout.trim()).toBe(
      before,
    );

    // RESTART: a fresh loop over the same log and repo.
    const second = await runLandLoop(featureOptions(fixture, features));
    // T-1 was NOT re-claimed (in_review is not claimable) …
    expect(second.processed.map((p) => p.ticketId)).not.toContain('T-1');
    expect(getTicket(fixture.log, 'T-1')!.status).toBe('in_review');
    // … its parked branch still exists …
    await git(fixture.repoRoot, ['rev-parse', '--verify', branch]);
    // … and the park record is intact.
    expect(parkedBranches(fixture.log).get('T-1')?.branch).toBe(branch);
    // The feature map was recorded ONCE — a repeated sweep appends nothing.
    expect(
      listEvents(fixture.log).filter((e) => e.eventType === FEATURES_RECORDED_EVENT),
    ).toHaveLength(1);
  });
});
