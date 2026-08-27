/**
 * W21-37. The red fixture is run 17 exactly: ticket B depends on an accepted
 * ticket A, and B's tree must contain A's files. Before this chapter B forked
 * from a base holding neither.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '@dokima/git';
import type { Ticket } from '@dokima/tickets';
import { resolveTicketBase } from './loop-land-base.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function repo(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'land-base-'));
  dirs.push(dir);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 't@dokima.test']);
  await git(dir, ['config', 'user.name', 'T']);
  await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'initialise product']);
  return dir;
}

/** A landed ticket branch carrying one file, exactly as the loop leaves it. */
async function landedBranch(dir: string, branch: string, file: string): Promise<void> {
  await git(dir, ['checkout', '-q', '-b', branch]);
  await fs.writeFile(path.join(dir, file), '{}\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', `add ${file}`]);
  await git(dir, ['checkout', '-q', 'main']);
}

function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    type: 'task',
    title: id,
    lane: 'solo',
    ownerId: null,
    status: 'ready',
    interface: null,
    role: null,
    writeScope: ['src/**'],
    dependsOn: [],
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    claimRunId: null,
    closedAt: null,
    ...over,
  } as Ticket;
}

describe('resolveTicketBase (W21-37)', () => {
  it('RED FIXTURE: run 17 — a ticket forks from its accepted dependency, not from an empty main', async () => {
    const dir = await repo();
    await landedBranch(dir, 'sw/A-a', 'package.json');
    const base = await resolveTicketBase({
      repoRoot: dir,
      ticket: ticket('B', { dependsOn: ['A'] }),
      tickets: [ticket('A', { status: 'done', title: 'a' }), ticket('B')],
      fallbackRef: 'main',
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(base.ref).toBe('sw/A-a');
    // the whole point: the dependency's file is reachable from the base
    const listed = await git(dir, ['ls-tree', '--name-only', base.ref]);
    expect(listed.stdout).toContain('package.json');
  });

  it('an in_review dependency is NOT a base — accepting it retroactively would launder C-4', async () => {
    const dir = await repo();
    await landedBranch(dir, 'sw/A-a', 'package.json');
    const base = await resolveTicketBase({
      repoRoot: dir,
      ticket: ticket('B', { dependsOn: ['A'] }),
      tickets: [ticket('A', { status: 'in_review', title: 'a' }), ticket('B')],
      fallbackRef: 'main',
    });
    expect(base).toMatchObject({ ok: true, ref: 'main', from: [] });
  });

  it('an accepted dependency whose branch is GONE refuses — it must not fall back to main', async () => {
    const dir = await repo();
    const base = await resolveTicketBase({
      repoRoot: dir,
      ticket: ticket('B', { dependsOn: ['A'] }),
      tickets: [ticket('A', { status: 'done', title: 'a' }), ticket('B')],
      fallbackRef: 'main',
    });
    expect(base.ok).toBe(false);
    if (base.ok) return;
    expect(base.reason).toContain('sw/A-a');
    expect(base.reason).toContain('not reachable');
  });

  it('two accepted dependencies compose into one base carrying both', async () => {
    const dir = await repo();
    await landedBranch(dir, 'sw/A-a', 'package.json');
    await landedBranch(dir, 'sw/C-c', 'tsconfig.json');
    const base = await resolveTicketBase({
      repoRoot: dir,
      ticket: ticket('B', { dependsOn: ['A', 'C'] }),
      tickets: [
        ticket('A', { status: 'done', title: 'a' }),
        ticket('C', { status: 'done', title: 'c' }),
        ticket('B'),
      ],
      fallbackRef: 'main',
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const listed = await git(dir, ['ls-tree', '--name-only', base.ref]);
    expect(listed.stdout).toContain('package.json');
    expect(listed.stdout).toContain('tsconfig.json');
  });

  it('a ticket with no dependencies is byte-identical to before — the fallback branch', async () => {
    const dir = await repo();
    const base = await resolveTicketBase({
      repoRoot: dir,
      ticket: ticket('B'),
      tickets: [ticket('B')],
      fallbackRef: 'main',
    });
    expect(base).toMatchObject({ ok: true, ref: 'main', from: [] });
  });
});

/**
 * W21-37 follow-up. The first version of the stale-worktree fix crashed run 18
 * outright: it removed the worktree directory and left the branch, so
 * `createWorktree -b sw/<ticket>` failed with "a branch named … already
 * exists" and the error escaped the loop with no ledger trace at all.
 */
describe('recreating a worktree left on a stale base (W21-37)', () => {
  it('RED FIXTURE: the branch goes with the directory, so the worktree can actually be recreated', async () => {
    const dir = await repo();
    await landedBranch(dir, 'sw/A-a', 'package.json');
    const { createWorktree, destroyWorktree, listWorktrees } = await import('@dokima/git');

    // A worktree forked from the empty main — run 17's exact leftover.
    const stale = await createWorktree({
      repoRoot: dir,
      ticketId: 'B',
      slug: 'b',
      baseRef: 'main',
    });
    expect((await git(stale.path, ['ls-tree', '--name-only', 'HEAD'])).stdout).not.toContain(
      'package.json',
    );

    await destroyWorktree(stale, { deleteBranch: true });
    expect(await listWorktrees(dir)).toHaveLength(1); // the main checkout only

    // Recreating on the RIGHT base now succeeds where it used to throw.
    const fresh = await createWorktree({
      repoRoot: dir,
      ticketId: 'B',
      slug: 'b',
      baseRef: 'sw/A-a',
    });
    expect((await git(fresh.path, ['ls-tree', '--name-only', 'HEAD'])).stdout).toContain(
      'package.json',
    );
  });

  it('leaving the branch behind is what broke it — recreate refuses while it exists', async () => {
    const dir = await repo();
    const stale = await createWorktreeFor(dir, 'B');
    const { destroyWorktree, createWorktree } = await import('@dokima/git');
    await destroyWorktree(stale); // no deleteBranch — the bug
    await expect(
      createWorktree({ repoRoot: dir, ticketId: 'B', slug: 'b', baseRef: 'main' }),
    ).rejects.toThrow(/already exists/);
  });
});

async function createWorktreeFor(dir: string, ticketId: string) {
  const { createWorktree } = await import('@dokima/git');
  return createWorktree({ repoRoot: dir, ticketId, slug: ticketId.toLowerCase(), baseRef: 'main' });
}
