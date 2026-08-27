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
  /** W21-60: the named paths had no changes to stage — a refusal, not a scope problem. */
  nothingStaged?: boolean;
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
  /**
   * W21-60: nothing staged is a REFUSAL, not an exception.
   *
   * `git commit` with an empty index exits non-zero, so this line used to
   * throw out of the tool and out of `gitCommitTool`'s `{ok, reason}` contract
   * entirely — the agent got an exception where every other refusal gives it a
   * sentence it can act on. Live: run 44's session called commit once, the
   * branch tip did not move, and the file it had just written was still
   * unstaged. It then spent the rest of its budget without trying again.
   *
   * The two conditions are told apart because the fixes are opposite: a scope
   * violation means "you touched something you may not", and an empty index
   * means "the paths you named have no changes — name the file you actually
   * edited".
   */
  if (staged.length === 0) {
    return { committed: false, violations: [], nothingStaged: true };
  }
  await git(handle.path, ['commit', '-m', opts.message]);
  return { committed: true, violations: [] };
}
