/**
 * P6-05: the synthetic-branch engine's landing and its refusals, on real git
 * fixtures. Every refusal path here is a RED fixture in the docs/TESTING.md
 * sense — each asserts the base branch is left UNTOUCHED and the synthetic
 * worktree/branch cleaned up, which is exactly what a broken guard would
 * violate: red verify, member drift, base-advanced, and a code conflict.
 * The metadata carve-out is proven in both directions (metadata-only conflict
 * lands with the base's version; a code conflict refuses whole).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { createTicket, getTicket } from '@dokima/tickets';
import { git } from '@dokima/git';
import { FEATURE_LANDED_EVENT, parkedBranches } from './loop-land-feature.js';
import {
  landParkedFeature,
  type FeatureLandingContext,
  type SyntheticBranchRecord,
} from './loop-land-feature-merge.js';

interface Fixture {
  repoRoot: string;
  log: EventLog;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-feature-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await fs.writeFile(path.join(repoRoot, 'board.json'), '{"rows":"base"}\n');
  await git(repoRoot, ['add', '--', 'README.md', 'board.json']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-feature-mdb-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  cleanups.push(async () => {
    log.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(dbDir, { recursive: true, force: true });
  });
  return { repoRoot, log };
}

/** A parked member: worktree + branch off main with one committed file, like a close-gate-green ticket leaves behind. */
async function makeMember(
  fixture: Fixture,
  ticketId: string,
  files: Record<string, string>,
) {
  createTicket(fixture.log, 'worker-1', {
    id: ticketId,
    type: 'task',
    title: `Ticket ${ticketId}`,
    lane: ticketId,
    writeScope: [`${ticketId}/**`],
    verify: 'true',
  });
  const branch = `sw/${ticketId.toLowerCase()}`;
  const wt = path.join(fixture.repoRoot, '.dokima', 'worktrees', ticketId);
  await git(fixture.repoRoot, ['worktree', 'add', '-b', branch, wt, 'main']);
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(wt, file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  await git(wt, ['add', '-A']);
  await git(wt, ['commit', '-m', `feat: ${ticketId}`]);
  const headSha = (await git(wt, ['rev-parse', 'HEAD'])).stdout.trim();
  return { ticketId, branch, headSha };
}

function context(
  fixture: Fixture,
  overrides: Partial<FeatureLandingContext> = {},
): FeatureLandingContext {
  return {
    log: fixture.log,
    actorId: 'worker-1',
    repoRoot: fixture.repoRoot,
    baseRef: 'main',
    metadataPaths: [],
    verifySynthetic: async () => ({ green: true, detail: 'fake verify' }),
    ...overrides,
  };
}

async function mainSha(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ['rev-parse', 'main'])).stdout.trim();
}

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  return git(repoRoot, ['rev-parse', '--verify', ref]).then(
    () => true,
    () => false,
  );
}

/** Shared refusal contract: base untouched, synthetic gone, parked member branches kept. */
async function expectRefusalLeftEverythingIntact(
  fixture: Fixture,
  before: string,
  members: { branch: string }[],
  record: SyntheticBranchRecord | null,
) {
  expect(await mainSha(fixture.repoRoot)).toBe(before);
  for (const m of members) {
    expect(await refExists(fixture.repoRoot, m.branch)).toBe(true);
  }
  if (record) {
    expect(await refExists(fixture.repoRoot, record.branch)).toBe(false);
    await expect(fs.stat(record.worktreePath)).rejects.toThrow();
  }
}

describe('landParkedFeature (P6-05)', () => {
  it('lands a complete feature as ONE merge, verified on the synthetic head, and cleans up', async () => {
    const fixture = await setupFixture();
    const m1 = await makeMember(fixture, 'T-1', { 'T-1/a.txt': 'one\n' });
    const m2 = await makeMember(fixture, 'T-2', { 'T-2/b.txt': 'two\n' });
    const before = await mainSha(fixture.repoRoot);
    let verified: SyntheticBranchRecord | null = null;
    const outcome = await landParkedFeature(
      context(fixture, {
        verifySynthetic: async (record) => {
          verified = record;
          return { green: true };
        },
      }),
      'F-auth',
      [m1, m2],
    );
    expect(outcome.landed).toBe(true);
    // Verify ran on the synthetic head, with both members merged into it.
    expect(verified).not.toBeNull();
    expect(verified!.merged.map((m) => m.ticketId)).toEqual(['T-1', 'T-2']);
    // ONE merge on main: first-parent history gained exactly one commit.
    const after = await mainSha(fixture.repoRoot);
    expect(after).not.toBe(before);
    const firstParent = (
      await git(fixture.repoRoot, ['rev-parse', 'main~1'])
    ).stdout.trim();
    expect(firstParent).toBe(before);
    const message = (await git(fixture.repoRoot, ['log', '-1', '--format=%B', 'main']))
      .stdout;
    expect(message).toContain('Merge feature F-auth');
    expect(message).toContain('T-1, T-2');
    // Both members' files are on main.
    await expect(
      fs.readFile(path.join(fixture.repoRoot, 'T-1/a.txt'), 'utf8'),
    ).resolves.toBe('one\n');
    await expect(
      fs.readFile(path.join(fixture.repoRoot, 'T-2/b.txt'), 'utf8'),
    ).resolves.toBe('two\n');
    // Synthetic + member branches cleaned up; the landing is ledgered and
    // retires nothing-parked (the event names the members).
    expect(await refExists(fixture.repoRoot, verified!.branch)).toBe(false);
    expect(await refExists(fixture.repoRoot, m1.branch)).toBe(false);
    expect(await refExists(fixture.repoRoot, m2.branch)).toBe(false);
    const landedEvents = listEvents(fixture.log).filter(
      (e) => e.eventType === FEATURE_LANDED_EVENT,
    );
    expect(landedEvents).toHaveLength(1);
    expect((landedEvents[0]!.payload as { tickets: string[] }).tickets).toEqual([
      'T-1',
      'T-2',
    ]);
    expect(parkedBranches(fixture.log).size).toBe(0);
    // The human trail: a comment on each member, and it is not a status flip.
    expect(getTicket(fixture.log, 'T-1')!.history.some((h) => h.verb === 'comment')).toBe(
      true,
    );
  });

  it('REFUSES on red verify: main untouched, synthetic cleaned up, parked branches kept', async () => {
    const fixture = await setupFixture();
    const m1 = await makeMember(fixture, 'T-1', { 'T-1/a.txt': 'one\n' });
    const before = await mainSha(fixture.repoRoot);
    let record: SyntheticBranchRecord | null = null;
    const outcome = await landParkedFeature(
      context(fixture, {
        verifySynthetic: async (r) => {
          record = r;
          return { green: false, detail: 'tests failed on the synthetic head' };
        },
      }),
      'F-auth',
      [m1],
    );
    expect(outcome.landed).toBe(false);
    expect(outcome.detail).toContain('verify RED on the synthetic head');
    expect(outcome.detail).toContain('tests failed');
    await expectRefusalLeftEverythingIntact(fixture, before, [m1], record);
  });

  it('REFUSES on member drift: a branch that moved after its park does not land', async () => {
    const fixture = await setupFixture();
    const m1 = await makeMember(fixture, 'T-1', { 'T-1/a.txt': 'one\n' });
    // The branch moves AFTER the park recorded its tested head.
    const wt = path.join(fixture.repoRoot, '.dokima', 'worktrees', 'T-1');
    await fs.writeFile(path.join(wt, 'T-1/late.txt'), 'sneaky\n');
    await git(wt, ['add', '-A']);
    await git(wt, ['commit', '-m', 'late: unreviewed commit after park']);
    const before = await mainSha(fixture.repoRoot);
    let record: SyntheticBranchRecord | null = null;
    const outcome = await landParkedFeature(
      context(fixture, {
        verifySynthetic: async (r) => {
          record = r;
          return { green: true };
        },
      }),
      'F-auth',
      [m1],
    );
    expect(outcome.landed).toBe(false);
    expect(outcome.detail).toContain('T-1 moved after its park');
    await expectRefusalLeftEverythingIntact(fixture, before, [m1], record);
  });

  it('REFUSES when the base advanced under the landing', async () => {
    const fixture = await setupFixture();
    const m1 = await makeMember(fixture, 'T-1', { 'T-1/a.txt': 'one\n' });
    let record: SyntheticBranchRecord | null = null;
    let before = '';
    const outcome = await landParkedFeature(
      context(fixture, {
        // The verify hook is the mid-flight window: main advances while the
        // synthetic head is being tested.
        verifySynthetic: async (r) => {
          record = r;
          await fs.writeFile(path.join(fixture.repoRoot, 'hotfix.txt'), 'x\n');
          await git(fixture.repoRoot, ['add', '-A']);
          await git(fixture.repoRoot, ['commit', '-m', 'hotfix lands mid-verify']);
          before = await mainSha(fixture.repoRoot);
          return { green: true };
        },
      }),
      'F-auth',
      [m1],
    );
    expect(outcome.landed).toBe(false);
    expect(outcome.detail).toContain('main advanced under the landing');
    await expectRefusalLeftEverythingIntact(fixture, before, [m1], record);
  });

  it('REFUSES whole on a CODE conflict between members — never hand-resolved, never in pieces', async () => {
    const fixture = await setupFixture();
    const m1 = await makeMember(fixture, 'T-1', { 'shared.txt': 'from T-1\n' });
    const m2 = await makeMember(fixture, 'T-2', { 'shared.txt': 'from T-2\n' });
    const before = await mainSha(fixture.repoRoot);
    let verifyRan = false;
    const outcome = await landParkedFeature(
      context(fixture, {
        verifySynthetic: async () => {
          verifyRan = true;
          return { green: true };
        },
      }),
      'F-auth',
      [m1, m2],
    );
    expect(outcome.landed).toBe(false);
    expect(outcome.detail).toContain('conflicted on the synthetic branch');
    expect(outcome.detail).toContain('does not land in pieces');
    expect(verifyRan).toBe(false); // refused before spending a verify
    await expectRefusalLeftEverythingIntact(fixture, before, [m1, m2], null);
    // The leaked-synthetic check without a record: no wave/ branch remains.
    const branches = (await git(fixture.repoRoot, ['branch', '--list', 'wave/*'])).stdout;
    expect(branches.trim()).toBe('');
  });

  it('carves out metadata-only conflicts to the BASE version and still lands', async () => {
    const fixture = await setupFixture();
    // The member rewrote board.json (bookkeeping history); main's copy is truth.
    const m1 = await makeMember(fixture, 'T-1', {
      'T-1/a.txt': 'one\n',
      'board.json': '{"rows":"member-copy"}\n',
    });
    // main's board also moved, so the two conflict.
    await fs.writeFile(
      path.join(fixture.repoRoot, 'board.json'),
      '{"rows":"root-truth"}\n',
    );
    await git(fixture.repoRoot, ['add', '-A']);
    await git(fixture.repoRoot, ['commit', '-m', 'chore(board): root update']);
    const outcome = await landParkedFeature(
      context(fixture, { metadataPaths: ['board.json'] }),
      'F-auth',
      [m1],
    );
    expect(outcome.landed).toBe(true);
    await expect(
      fs.readFile(path.join(fixture.repoRoot, 'board.json'), 'utf8'),
    ).resolves.toBe('{"rows":"root-truth"}\n');
    await expect(
      fs.readFile(path.join(fixture.repoRoot, 'T-1/a.txt'), 'utf8'),
    ).resolves.toBe('one\n');
  });

  it('REFUSES when the repo is not checked out on the base branch', async () => {
    const fixture = await setupFixture();
    const m1 = await makeMember(fixture, 'T-1', { 'T-1/a.txt': 'one\n' });
    await git(fixture.repoRoot, ['checkout', '-q', '-b', 'not-main']);
    const outcome = await landParkedFeature(context(fixture), 'F-auth', [m1]);
    expect(outcome.landed).toBe(false);
    expect(outcome.detail).toContain('checked out on not-main');
  });
});
