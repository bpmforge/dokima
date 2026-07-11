import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  branchNameFor,
  createWorktree,
  destroyWorktree,
  listWorktrees,
} from './worktree.js';
import { git } from './git-cli.js';
import { createTempRepo, type TempRepo } from './test-helpers.js';

describe('branchNameFor', () => {
  it('builds sw/<ticket-id>-<slug> and slugifies the slug', () => {
    expect(branchNameFor('W0-06', 'Git Worktree Service')).toBe(
      'sw/W0-06-git-worktree-service',
    );
  });
});

describe('worktree lifecycle', () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('creates a worktree on the expected branch', async () => {
    repo = await createTempRepo();
    const handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-06',
      slug: 'git worktree service',
    });

    expect(handle.branch).toBe('sw/W0-06-git-worktree-service');
    const stat = await fs.stat(handle.path);
    expect(stat.isDirectory()).toBe(true);

    const { stdout: currentBranch } = await git(handle.path, [
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);
    expect(currentBranch).toBe(handle.branch);

    const worktrees = await listWorktrees(repo.repoRoot);
    expect(worktrees.some((w) => w.branch === handle.branch)).toBe(true);
  });

  it('destroys a worktree leak-free: directory gone, no worktree-list entry, prunable state clean', async () => {
    repo = await createTempRepo();
    const handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-09',
      slug: 'leak check',
    });

    await destroyWorktree(handle);

    await expect(fs.stat(handle.path)).rejects.toThrow();

    const worktrees = await listWorktrees(repo.repoRoot);
    expect(worktrees.some((w) => w.path === handle.path)).toBe(false);

    // A fully-clean worktree remove leaves no `.git/worktrees/<name>` admin dir either.
    const { stdout } = await git(repo.repoRoot, ['worktree', 'list', '--porcelain']);
    expect(stdout).not.toContain(handle.path);
  });

  it('deletes the ticket branch when deleteBranch is requested', async () => {
    repo = await createTempRepo();
    const handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-10',
      slug: 'branch cleanup',
    });

    await destroyWorktree(handle, { deleteBranch: true });

    const { stdout } = await git(repo.repoRoot, ['branch', '--list', handle.branch]);
    expect(stdout.trim()).toBe('');
  });
});
