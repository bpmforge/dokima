/**
 * Write-scope violation detection by diff (BLUEPRINT §3.4, SC-01). This is
 * the basic glob-classification primitive only: given the paths a session
 * actually touched (observed via `git diff`, not the session's own claims)
 * and a ticket's `write_scope[]` globs, report which touched paths fall
 * outside scope. The full SC-01 enforcement — hard exclusions
 * (`.git/**`, `.github/workflows/**`, `.dokima/**`), symlink-escape
 * resolution via realpath, and refuse-to-apply — is `packages/git`'s
 * `checkWriteScope` (lands with harbormaster). The glob dialect itself is
 * `@dokima/shared`'s canonical implementation (G-20) — `loop` may not
 * import `git` (ARCHITECTURE.md §4), but both may import `shared`.
 *
 * Uses `node:child_process` directly (not the `execa` wrapper) so this
 * ticket's write_scope doesn't need a `package.json` dependency edit for a
 * package outside it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { globToRegExp } from '@dokima/shared';

const execFileAsync = promisify(execFile);

/** Paths touched by the session that fall outside every write_scope glob. */
export function detectScopeViolations(
  changedPaths: readonly string[],
  writeScope: readonly string[],
): readonly string[] {
  const matchers = writeScope.map(globToRegExp);
  return changedPaths.filter((path) => !matchers.some((matcher) => matcher.test(path)));
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function splitLines(output: string): string[] {
  return output.split('\n').filter((line) => line.length > 0);
}

/**
 * Paths a session touched inside its worktree: tracked changes against
 * `baseRef` (staged and unstaged) plus new untracked files. Real `git`
 * output, not the session's self-reported file list (SC-02: never trust an
 * agent-session claim for a state-changing decision).
 */
export async function computeChangedPaths(
  cwd: string,
  baseRef = 'HEAD',
): Promise<readonly string[]> {
  const [diffOutput, untrackedOutput] = await Promise.all([
    git(cwd, ['diff', '--name-only', baseRef]),
    git(cwd, ['ls-files', '--others', '--exclude-standard']),
  ]);
  const paths = new Set([...splitLines(diffOutput), ...splitLines(untrackedOutput)]);
  return [...paths];
}
