import { checkWriteScope, type ScopeViolation } from './scope.js';
import { git } from './git-cli.js';
import type { WorktreeHandle } from './worktree.js';

export interface CommitWithScopeOptions {
  /** Explicit repo-relative paths to stage. Never pass a wildcard/`-A` here. */
  paths: string[];
  message: string;
  writeScope: string[];
}

export interface CommitResult {
  committed: boolean;
  violations: ScopeViolation[];
}

export async function stagePaths(handle: WorktreeHandle, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    throw new Error('stagePaths requires at least one explicit path');
  }
  await git(handle.path, ['add', '--', ...paths]);
}

export async function getStagedPaths(handle: WorktreeHandle): Promise<string[]> {
  const { stdout } = await git(handle.path, ['diff', '--cached', '--name-only']);
  return stdout.split('\n').filter((line) => line.length > 0);
}

/**
 * Stages explicit paths, then enforces write_scope by diffing what actually
 * landed in the index (SC-01) before allowing the commit. Any out-of-scope,
 * hard-excluded, or symlink-escaping path unstages everything and refuses —
 * the commit never happens.
 */
export async function commitWithScopeCheck(
  handle: WorktreeHandle,
  opts: CommitWithScopeOptions,
): Promise<CommitResult> {
  await stagePaths(handle, opts.paths);
  const staged = await getStagedPaths(handle);
  const violations = await checkWriteScope(staged, opts.writeScope, handle.path);
  if (violations.length > 0) {
    if (staged.length > 0) {
      await git(handle.path, ['reset', '--', ...staged]);
    }
    return { committed: false, violations };
  }
  await git(handle.path, ['commit', '-m', opts.message]);
  return { committed: true, violations: [] };
}
