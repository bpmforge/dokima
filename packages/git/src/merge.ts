import { git } from './git-cli.js';

export interface MergeLocalOptions {
  repoRoot: string;
  targetBranch: string;
  sourceBranch: string;
  message?: string;
}

/**
 * Local-forge-less landing path: merges a ticket branch into the target
 * branch with --no-ff (BLUEPRINT §3.9) from the main repo checkout. Refuses
 * if repoRoot isn't currently on targetBranch — this never switches branches
 * out from under the caller.
 */
export async function mergeLocal(opts: MergeLocalOptions): Promise<void> {
  const { stdout } = await git(opts.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = stdout.trim();
  if (currentBranch !== opts.targetBranch) {
    throw new Error(
      `mergeLocal: repoRoot is checked out on '${currentBranch}', expected target branch '${opts.targetBranch}'`,
    );
  }
  const message = opts.message ?? `Merge ${opts.sourceBranch} into ${opts.targetBranch}`;
  await git(opts.repoRoot, ['merge', '--no-ff', opts.sourceBranch, '-m', message]);
}
