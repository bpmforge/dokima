import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorktree, git, type WorktreeHandle } from '@shipwright/git';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { claimTicket, createTicket, getTicket, startTicket } from '@shipwright/tickets';
import {
  commitHumanEdit,
  humanEditConflictDecideCard,
  resolveHumanEditConflict,
} from './conflict-rebase.js';

async function createTempRepo(): Promise<{
  repoRoot: string;
  cleanup: () => Promise<void>;
}> {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'shipwright-conflict-rebase-'),
  );
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  // Ignore the ticket worktree's own metadata dir (HARD_EXCLUSIONS in
  // @shipwright/git's scope.ts) — it must never show up as a "human edit".
  await fs.writeFile(path.join(repoRoot, '.gitignore'), '.shipwright/\n');
  await git(repoRoot, ['add', '--', '.gitignore']);
  await fs.mkdir(path.join(repoRoot, 'src', 'auth'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'auth', 'session.ts'), 'shared\n');
  await git(repoRoot, ['add', '--', 'src/auth/session.ts']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return { repoRoot, cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }) };
}

interface Fixture {
  repoRoot: string;
  log: EventLog;
  worktree: WorktreeHandle;
  cleanup: () => Promise<void>;
}

async function setupFixture(ticketId: string): Promise<Fixture> {
  const repo = await createTempRepo();
  const dbDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'shipwright-conflict-rebase-db-'),
  );
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createIdentity(log, { id: 'human-1', name: 'P2 Dev', kind: 'human' });
  createTicket(log, 'worker-1', {
    id: ticketId,
    type: 'task',
    title: 'Auth ticket',
    lane: 'core',
    writeScope: ['src/auth/**'],
    verify: 'true',
  });
  claimTicket(log, { ticketId, actorId: 'worker-1' });
  startTicket(log, { ticketId, actorId: 'worker-1' });
  const worktree = await createWorktree({
    repoRoot: repo.repoRoot,
    ticketId,
    slug: 'auth',
  });
  return {
    repoRoot: repo.repoRoot,
    log,
    worktree,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
      await repo.cleanup();
    },
  };
}

describe('commitHumanEdit', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('commits the working-tree edit onto the checkout HEAD', async () => {
    fixture = await setupFixture('T-commit');
    await fs.writeFile(
      path.join(fixture.repoRoot, 'src', 'auth', 'session.ts'),
      'human-version\n',
    );
    const sha = await commitHumanEdit({
      repoRoot: fixture.repoRoot,
      paths: ['src/auth/session.ts'],
      message: 'human edit',
    });
    const { stdout: head } = await git(fixture.repoRoot, ['rev-parse', 'HEAD']);
    expect(head.trim()).toBe(sha);
    const { stdout: status } = await git(fixture.repoRoot, ['status', '--porcelain']);
    expect(status.trim()).toBe('');
  });
});

describe('humanEditConflictDecideCard', () => {
  it('offers take-mine / take-agents / merge-view, recommending take-mine (human wins)', () => {
    const card = humanEditConflictDecideCard('T-1', 'Auth ticket', [
      'src/auth/session.ts',
    ]);
    expect(card.options.map((o) => o.label)).toEqual([
      'take mine',
      "take agent's",
      'merge view',
    ]);
    expect(card.recommendedDefault).toBe('take mine');
    expect(card.context).toContain('src/auth/session.ts');
  });
});

describe('resolveHumanEditConflict', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('rebases cleanly and re-grounds when the human edit does not collide with the agent commit', async () => {
    fixture = await setupFixture('T-clean');
    const { log, worktree, repoRoot } = fixture;

    // Agent commits an unrelated file in its worktree.
    await fs.writeFile(
      path.join(worktree.path, 'src', 'auth', 'other.ts'),
      'export {};\n',
    );
    await git(worktree.path, ['add', '--', 'src/auth/other.ts']);
    await git(worktree.path, ['commit', '-m', 'agent: add other.ts']);

    // Human edits session.ts in their own checkout.
    await fs.writeFile(
      path.join(repoRoot, 'src', 'auth', 'session.ts'),
      'human-version\n',
    );

    const outcome = await resolveHumanEditConflict({
      actorId: 'worker-1',
      humanActorId: 'human-1',
      log,
      ticket: getTicket(log, 'T-clean')!,
      worktree,
      baseRef: 'main',
      repoRoot,
      conflictedPaths: ['src/auth/session.ts'],
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(outcome.kind).toBe('rebased');
    const rebasedEvents = listEvents(log).filter(
      (e) => e.eventType === 'conflict.rebased',
    );
    expect(rebasedEvents).toHaveLength(1);
    expect(rebasedEvents[0]).toMatchObject({ ticketId: 'T-clean', actorId: 'worker-1' });

    // The rebased worktree now contains both the agent's and the human's changes.
    const merged = await fs.readFile(
      path.join(worktree.path, 'src', 'auth', 'session.ts'),
      'utf8',
    );
    expect(merged).toBe('human-version\n');
    const otherExists = await fs
      .stat(path.join(worktree.path, 'src', 'auth', 'other.ts'))
      .then(() => true)
      .catch(() => false);
    expect(otherExists).toBe(true);

    // The ticket itself is untouched — re-grounding is the micro-loop's job, not this module's.
    const ticket = getTicket(log, 'T-clean');
    expect(ticket?.status).toBe('in_progress');
  });

  it('parks the ticket with a Decide card on a material rebase conflict — human wins, agent work never lost', async () => {
    fixture = await setupFixture('T-conflict');
    const { log, worktree, repoRoot } = fixture;

    // Agent replaces the same line in its worktree.
    await fs.writeFile(
      path.join(worktree.path, 'src', 'auth', 'session.ts'),
      'agent-version\n',
    );
    await git(worktree.path, ['add', '--', 'src/auth/session.ts']);
    await git(worktree.path, ['commit', '-m', 'agent: change session.ts']);

    // Human replaces the same line differently, in their own checkout.
    await fs.writeFile(
      path.join(repoRoot, 'src', 'auth', 'session.ts'),
      'human-version\n',
    );

    const outcome = await resolveHumanEditConflict({
      actorId: 'worker-1',
      humanActorId: 'human-1',
      log,
      ticket: getTicket(log, 'T-conflict')!,
      worktree,
      baseRef: 'main',
      repoRoot,
      conflictedPaths: ['src/auth/session.ts'],
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(outcome.kind).toBe('parked');
    if (outcome.kind !== 'parked') throw new Error('unreachable');
    expect(outcome.decideCard.recommendedDefault).toBe('take mine');

    const parkedEvents = listEvents(log).filter((e) => e.eventType === 'conflict.parked');
    expect(parkedEvents).toHaveLength(1);
    expect(parkedEvents[0]).toMatchObject({
      ticketId: 'T-conflict',
      actorId: 'worker-1',
      payload: { conflictedPaths: ['src/auth/session.ts'] },
    });

    const ticket = getTicket(log, 'T-conflict');
    expect(ticket?.status).toBe('ready');
    expect(ticket?.ownerId).toBeNull();
    const evidenceComment = ticket?.history.findLast((entry) => entry.verb === 'comment');
    expect(evidenceComment?.body).toEqual(
      expect.stringContaining('blocked: human-edit-conflict'),
    );
    expect(evidenceComment?.body).toEqual(expect.stringContaining('DECIDE CARD'));

    // The human's commit landed on the base branch regardless of the agent's fate.
    const { stdout: mainContent } = await git(repoRoot, [
      'show',
      'main:src/auth/session.ts',
    ]);
    expect(mainContent.trim()).toBe('human-version');

    // The worktree is left clean — no rebase left mid-flight.
    const { stdout: status } = await git(worktree.path, ['status', '--porcelain']);
    expect(status.trim()).toBe('');
  });

  it('rethrows a non-conflict rebase failure without parking the ticket', async () => {
    fixture = await setupFixture('T-badref');
    const { log, worktree, repoRoot } = fixture;

    await fs.writeFile(
      path.join(repoRoot, 'src', 'auth', 'session.ts'),
      'human-version\n',
    );

    await expect(
      resolveHumanEditConflict({
        actorId: 'worker-1',
        humanActorId: 'human-1',
        log,
        ticket: getTicket(log, 'T-badref')!,
        worktree,
        baseRef: 'no-such-branch',
        repoRoot,
        conflictedPaths: ['src/auth/session.ts'],
        now: () => '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow();

    const ticket = getTicket(log, 'T-badref');
    expect(ticket?.status).toBe('in_progress');
    expect(listEvents(log).some((e) => e.eventType === 'conflict.parked')).toBe(false);
  });
});
