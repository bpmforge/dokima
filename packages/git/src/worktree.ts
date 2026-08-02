import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git } from './git-cli.js';

export interface WorktreeHandle {
  repoRoot: string;
  path: string;
  branch: string;
  ticketId: string;
}

export interface CreateWorktreeOptions {
  repoRoot: string;
  ticketId: string;
  slug: string;
  /** Commit-ish to branch from. Defaults to HEAD. */
  baseRef?: string;
  /** Defaults to `<repoRoot>/.dokima/worktrees`. */
  worktreesDir?: string;
}

export interface DestroyWorktreeOptions {
  deleteBranch?: boolean;
}

export interface WorktreeListEntry {
  path: string;
  branch: string | null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function branchNameFor(ticketId: string, slug: string): string {
  return `sw/${ticketId}-${slugify(slug)}`;
}

export async function createWorktree(
  opts: CreateWorktreeOptions,
): Promise<WorktreeHandle> {
  const worktreesDir =
    opts.worktreesDir ?? path.join(opts.repoRoot, '.dokima', 'worktrees');
  const branch = branchNameFor(opts.ticketId, opts.slug);
  const worktreePath = path.join(worktreesDir, opts.ticketId);
  await fs.mkdir(worktreesDir, { recursive: true });
  await git(opts.repoRoot, [
    'worktree',
    'add',
    '-b',
    branch,
    worktreePath,
    opts.baseRef ?? 'HEAD',
  ]);
  return { repoRoot: opts.repoRoot, path: worktreePath, branch, ticketId: opts.ticketId };
}

export async function destroyWorktree(
  handle: WorktreeHandle,
  opts: DestroyWorktreeOptions = {},
): Promise<void> {
  await git(handle.repoRoot, ['worktree', 'remove', '--force', handle.path]);
  await git(handle.repoRoot, ['worktree', 'prune']);
  if (opts.deleteBranch) {
    await git(handle.repoRoot, ['branch', '-D', handle.branch]);
  }
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeListEntry[]> {
  const { stdout } = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  const entries: WorktreeListEntry[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (currentPath) entries.push({ path: currentPath, branch: currentBranch });
      currentPath = line.slice('worktree '.length);
      currentBranch = null;
    } else if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length).replace('refs/heads/', '');
    }
  }
  if (currentPath) entries.push({ path: currentPath, branch: currentBranch });
  return entries;
}
