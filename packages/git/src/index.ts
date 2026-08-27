export { git, type GitOptions, type GitResult } from './git-cli.js';
export { globToRegExp, matchesGlob, matchesAnyGlob } from './glob.js';
export {
  checkWriteScope,
  HARD_EXCLUSIONS,
  type ScopeViolation,
  type ScopeViolationReason,
} from './scope.js';
export {
  createWorktree,
  destroyWorktree,
  listWorktrees,
  branchNameFor,
  type WorktreeHandle,
  type CreateWorktreeOptions,
  type DestroyWorktreeOptions,
  type WorktreeListEntry,
} from './worktree.js';
export {
  stagePaths,
  getStagedPaths,
  commitWithScopeCheck,
  type CommitWithScopeOptions,
  type CommitResult,
} from './commit.js';
export { mergeLocal, type MergeLocalOptions } from './merge.js';
// W13-40: resolve the repo's branch instead of guessing its name.
export { resolveCurrentBranch } from './branch.js';
