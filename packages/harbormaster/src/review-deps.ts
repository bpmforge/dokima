/**
 * W23-56 — did this change touch the project's dependencies?
 *
 * A local-only project has no advisory data, so `npm audit` cannot run there
 * and tool-deps is NOT RUN. But the W23-51 baseline counts only advisories a
 * change INTRODUCES, and a change that leaves every root manifest and
 * lockfile byte-identical to its base has the base's dependency set exactly:
 * it cannot have introduced one. That is measured here, from git and the
 * worktree, never inferred from the ticket or the diff summary.
 *
 * Fails toward "unknown": any git failure, or a file that cannot be read, is
 * null — and null is never read as unchanged.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CheckEvidence, RunSecurityChecksOptions } from './security-checks.js';

const execFileAsync = promisify(execFile);

/** What `npm audit` resolves the dependency set from, at the project root. */
export const DEPENDENCY_FILES: readonly string[] = Object.freeze([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

async function atBase(repo: string, base: string, file: string): Promise<Buffer | null> {
  const { stdout } = await execFileAsync('git', [
    '-C',
    repo,
    'ls-tree',
    '--name-only',
    base,
    '--',
    file,
  ]);
  if (stdout.trim() === '') return null;
  const shown = await execFileAsync('git', ['-C', repo, 'show', `${base}:${file}`], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
  });
  return shown.stdout;
}

async function inWorktree(repo: string, file: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(repo, file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function dependenciesUnchangedSince(
  worktreePath: string,
  baseCommit: string,
): Promise<boolean | null> {
  try {
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'rev-parse',
      '--verify',
      `${baseCommit}^{commit}`,
    ]);
    for (const file of DEPENDENCY_FILES) {
      const [before, now] = await Promise.all([
        atBase(worktreePath, baseCommit, file),
        inWorktree(worktreePath, file),
      ]);
      if (before === null && now === null) continue;
      if (before === null || now === null || !before.equals(now)) return false;
    }
    return true;
  } catch {
    return null;
  }
}

/** W23-56: the project's answer to "may a ticket be accepted without a dependency audit?" */
export type UnauditedDependenciesPolicy = 'block' | 'allow';

/** W23-56: where that answer lives, in the PROJECT ROOT's .dokima/settings.json. */
export const UNAUDITED_DEPENDENCIES_SETTING = 'security.unauditedDependencies';

/**
 * W23-56: the dependency audit under local-only, which has no advisory data to
 * read. A change that left every manifest and lockfile as its base had them
 * cannot have introduced an advisory (W23-51 counts only introduced ones), so
 * there is nothing for this ticket to audit. Otherwise it is NOT RUN, and the
 * project's policy decides whether that blocks — the default is that it does.
 */
export function localOnlyAudit(
  options: RunSecurityChecksOptions,
): Partial<CheckEvidence> {
  if (options.profile.dependenciesUnchangedSinceBase === true) {
    return {
      status: 'not_applicable',
      reason:
        "every dependency manifest and lockfile is identical to the ticket's base, so this " +
        'change cannot have introduced an advisory; nothing for it to audit',
    };
  }
  const reason =
    'this project is local-only and has no advisory data to audit against, so the ' +
    'dependency audit did not run. Its coverage is missing, not clean.';
  return options.unauditedDependencies === 'allow'
    ? {
        status: 'unavailable',
        reason,
        waived: `${UNAUDITED_DEPENDENCIES_SETTING} is "allow" in this project: a change to its dependencies is accepted without an audit`,
      }
    : { status: 'unavailable', reason };
}

/** W23-56: the one waiver there is — a dependency audit that could not run. */
export function isWaivedNotRun(check: {
  readonly checkId: string;
  readonly status: string;
  readonly waived?: unknown;
}): boolean {
  return (
    check.checkId === 'tool-deps' &&
    check.status === 'unavailable' &&
    typeof check.waived === 'string' &&
    check.waived.length > 0
  );
}
