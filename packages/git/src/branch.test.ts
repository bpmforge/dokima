import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCurrentBranch } from './branch.js';
import { git } from './git-cli.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

/**
 * A repo on `trunkName`. Deliberately NOT `createTempRepo`, which hardcodes
 * `main` — the whole point here is a trunk that is called something else.
 */
async function repoOn(trunkName: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-branch-test-'));
  dirs.push(repoRoot);
  await git(repoRoot, ['init', '-b', trunkName]);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return repoRoot;
}

describe('resolveCurrentBranch (W13-40)', () => {
  // The names are the point: `master` is what a plain `git init` produced on
  // the machine where this defect was measured, and `trunk` is there so the
  // test cannot pass by way of a second hardcoded guess.
  it.each(['main', 'master', 'trunk', 'develop'])(
    'reports the actual branch: %s',
    async (trunkName) => {
      const repoRoot = await repoOn(trunkName);
      expect(await resolveCurrentBranch(repoRoot)).toBe(trunkName);
    },
  );

  it('refuses a detached HEAD instead of guessing a branch', async () => {
    const repoRoot = await repoOn('master');
    const { stdout } = await git(repoRoot, ['rev-parse', 'HEAD']);
    await git(repoRoot, ['checkout', '--detach', stdout.trim()]);

    // The message has to name the condition. Guessing here is exactly what
    // produced `fatal: invalid reference: main` — a failure that reads like a
    // broken product rather than an unset base ref.
    await expect(resolveCurrentBranch(repoRoot)).rejects.toThrow(/detached HEAD/);
  });
});
