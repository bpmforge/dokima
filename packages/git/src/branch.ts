import { git } from './git-cli.js';

/**
 * The branch a repository is actually on (W13-40).
 *
 * WHY THIS EXISTS: `runLandLoop` used to default its base ref to the literal
 * string `'main'`. Measured on a customer project created with a plain
 * `git init` — whose default branch was `master` — every ticket refused with
 *
 *     fatal: invalid reference: main
 *
 * so not one ticket on that board was workable. The board built, the models
 * were configured, and the product simply could not start. That is the same
 * hardcode class as the shipped model names W13-36 removed: a customer works
 * with the repository they have, not the one we assumed they have.
 *
 * `berths.ts` already defaulted the same concept to `HEAD`, so the two
 * defaults for one idea disagreed inside one package. This resolves the name
 * rather than guessing it, and the loop now agrees with the berths.
 *
 * A DETACHED HEAD REFUSES. There is no honest branch to fork from and no
 * trunk to merge back into, so a fallback here would only move the failure
 * somewhere less legible — which is precisely what `'main'` did.
 */
export async function resolveCurrentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = stdout.trim();
  if (branch === '' || branch === 'HEAD') {
    throw new Error(
      `${repoRoot} is not on a branch (detached HEAD), so there is nothing to ` +
        'branch tickets from or merge them back into. Check out the branch you ' +
        'want this work to land on, or set a base ref explicitly.',
    );
  }
  return branch;
}
