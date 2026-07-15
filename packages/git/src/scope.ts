import { promises as fs } from 'node:fs';
import path from 'node:path';
import { matchesAnyGlob } from '@shipwright/shared';

// SC-01 (docs/SECURITY_CONTROLS.md): no write_scope may grant these, ever.
export const HARD_EXCLUSIONS = [
  '.git',
  '.git/**',
  '.github/workflows/**',
  '.shipwright/**',
];

export type ScopeViolationReason = 'hard-excluded' | 'outside-scope' | 'symlink-escape';

export interface ScopeViolation {
  path: string;
  reason: ScopeViolationReason;
}

async function realpathOfNearestAncestor(absPath: string): Promise<string> {
  let dir = path.dirname(absPath);
  const base = path.basename(absPath);
  for (;;) {
    try {
      const realDir = await fs.realpath(dir);
      return path.join(realDir, base);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return absPath;
      dir = parent;
    }
  }
}

async function resolvesWithinRoot(
  relPath: string,
  worktreeRoot: string,
  realRoot: string,
): Promise<boolean> {
  const absPath = path.join(worktreeRoot, relPath);
  let real: string;
  try {
    real = await fs.realpath(absPath);
  } catch {
    real = await realpathOfNearestAncestor(absPath);
  }
  const relative = path.relative(realRoot, real);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Checks a set of repo-relative paths (as produced by `git diff --name-only` /
 * `git diff --cached --name-only`) against a ticket's write_scope globs.
 * Symlinks are resolved via realpath before matching (SC-01): a path that
 * escapes the worktree via a symlink is refused even if its literal text
 * matches an in-scope glob.
 */
export async function checkWriteScope(
  paths: string[],
  writeScope: string[],
  worktreeRoot: string,
): Promise<ScopeViolation[]> {
  const violations: ScopeViolation[] = [];
  const realRoot = await fs.realpath(worktreeRoot);
  for (const relPath of paths) {
    const normalized = relPath.split(path.sep).join('/');
    if (matchesAnyGlob(normalized, HARD_EXCLUSIONS)) {
      violations.push({ path: relPath, reason: 'hard-excluded' });
      continue;
    }
    const withinRoot = await resolvesWithinRoot(relPath, worktreeRoot, realRoot);
    if (!withinRoot) {
      violations.push({ path: relPath, reason: 'symlink-escape' });
      continue;
    }
    if (!matchesAnyGlob(normalized, writeScope)) {
      violations.push({ path: relPath, reason: 'outside-scope' });
    }
  }
  return violations;
}
