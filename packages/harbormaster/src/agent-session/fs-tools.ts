/**
 * Local filesystem handlers for the closed tool set's read/list/search/
 * write/edit tools (`tools.ts`), bounded to the ticket worktree. `write`
 * and `edit` are a PRE-check (SC-17, FR-H6, D-023, W11-03) — refusing a
 * worktree escape, a symlink-escape, a `.git`/`.github/workflows`/`.dokima`
 * write, OR a path the ticket's `write_scope[]` globs don't grant, before
 * any of it ever touches disk — never the authoritative scope decision:
 * that is still `commit` (`git-tools.ts`'s `commitWithScopeCheck`, SC-01),
 * the only tool that makes anything durable, and it runs this same
 * three-way check again (hard-excluded / symlink-escape / outside-scope,
 * `packages/git/src/scope.ts`'s `checkWriteScope`) against the REAL git
 * diff — unmodified by this ticket, still authoritative, and still the
 * thing that catches a write that reached disk by some path this pre-check
 * didn't anticipate. A refusal here returns to the model as ordinary tool
 * result data (never a thrown exception the session can't recover from) —
 * the session sees why and may correct itself, per acceptance 1's "returns
 * to the model as a normal tool result".
 *
 * (W11-19) The hard-exclusion and write_scope checks each run TWICE: once
 * against the SURFACE path (the model-supplied text, before resolution —
 * gives the friendlier refusal message for the ordinary case) and once
 * against the RESOLVED path `resolveOrRefusal` produces (worktree-relative,
 * every ancestor symlink followed). An ancestor symlink whose surface path
 * is in scope but which resolves into `.git` — legitimately inside the same
 * worktree, so containment alone can't catch it — passes both surface
 * checks and only the resolved-path recheck sees where the write actually
 * lands.
 *
 * This is the barrel for the two chapters the containment/search logic
 * split into once this file passed the 400-line cap (CODE_BOOK_PROTOCOL.md):
 * `fs-containment.ts` (worktree containment, `assertRealWithinWorktree`,
 * the symlink-escape hardening) and `fs-search.ts` (the ReDoS-bounded
 * `search` handler). Callers keep importing `./fs-tools.js` unchanged.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HARD_EXCLUSIONS, matchesAnyGlob } from '@dokima/git';
import { classifyManifestFile } from '../scope.js';
import {
  ToolPathEscapeError,
  assertRealWithinWorktree,
  normalizeRelPath,
  resolveOrRefusal,
  resolveWithinWorktree,
} from './fs-containment.js';
import { isUnsafeSearchPattern, searchTool } from './fs-search.js';

export {
  ToolPathEscapeError,
  assertRealWithinWorktree,
  normalizeRelPath,
  resolveWithinWorktree,
  isUnsafeSearchPattern,
  searchTool,
};
export type { SearchToolArgs } from './fs-search.js';

function refuseIfHardExcluded(relPath: string): { ok: false; reason: string } | null {
  if (matchesAnyGlob(relPath, HARD_EXCLUSIONS)) {
    return {
      ok: false,
      reason: `"${relPath}" is hard-excluded (SC-01) and cannot be written directly`,
    };
  }
  return null;
}

/** SC-17's own check (FR-H6, W11-03): the path itself, not just its containment, must be granted by the ticket's write_scope globs before a write/edit tool call is allowed to touch disk. Checked AFTER containment (mirrors `checkWriteScope`'s hard-excluded → symlink-escape → outside-scope order) so a symlink escape is always reported as a symlink escape, never masked by an incidental scope mismatch. */
function refuseIfOutsideScope(
  relPath: string,
  writeScope: readonly string[],
): { ok: false; reason: string } | null {
  if (!matchesAnyGlob(relPath, [...writeScope])) {
    return {
      ok: false,
      reason: `"${relPath}" is outside the ticket's write_scope (SC-17) and was refused before it executed`,
    };
  }
  return null;
}

export interface ReadToolArgs {
  readonly path: string;
}

export async function readTool(cwd: string, args: ReadToolArgs): Promise<unknown> {
  const relPath = normalizeRelPath(args.path);
  const realRoot = await fs.realpath(cwd);
  const result = await classifyManifestFile(cwd, realRoot, relPath);
  if (result.status !== 'ok') {
    return { ok: false, status: result.status, path: relPath };
  }
  return { ok: true, path: relPath, content: result.content };
}

export interface ListToolArgs {
  readonly path?: string;
}

export async function listTool(cwd: string, args: ListToolArgs): Promise<unknown> {
  const relPath = normalizeRelPath(args.path ?? '.');
  const resolved = await resolveOrRefusal(cwd, relPath);
  if ('reason' in resolved) return resolved;
  const entries = await fs.readdir(resolved.abs, { withFileTypes: true });
  return {
    ok: true,
    path: relPath,
    entries: entries
      .filter((entry) => entry.name !== '.git')
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : 'file',
      })),
  };
}

export interface WriteToolArgs {
  readonly path: string;
  readonly content: string;
}

export async function writeTool(
  cwd: string,
  writeScope: readonly string[],
  args: WriteToolArgs,
): Promise<unknown> {
  const relPath = normalizeRelPath(args.path);
  const excluded = refuseIfHardExcluded(relPath);
  if (excluded) return excluded;
  const resolved = await resolveOrRefusal(cwd, relPath);
  if ('reason' in resolved) return resolved;
  const resolvedExcluded = refuseIfHardExcluded(resolved.realRelPath);
  if (resolvedExcluded) return resolvedExcluded;
  const outOfScope =
    refuseIfOutsideScope(relPath, writeScope) ??
    refuseIfOutsideScope(resolved.realRelPath, writeScope);
  if (outOfScope) return outOfScope;
  await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
  await fs.writeFile(resolved.abs, args.content, 'utf8');
  return { ok: true, path: relPath };
}

export interface EditToolArgs {
  readonly path: string;
  readonly oldString: string;
  readonly newString: string;
}

export async function editTool(
  cwd: string,
  writeScope: readonly string[],
  args: EditToolArgs,
): Promise<unknown> {
  const relPath = normalizeRelPath(args.path);
  const excluded = refuseIfHardExcluded(relPath);
  if (excluded) return excluded;
  const resolved = await resolveOrRefusal(cwd, relPath);
  if ('reason' in resolved) return resolved;
  const resolvedExcluded = refuseIfHardExcluded(resolved.realRelPath);
  if (resolvedExcluded) return resolvedExcluded;
  const outOfScope =
    refuseIfOutsideScope(relPath, writeScope) ??
    refuseIfOutsideScope(resolved.realRelPath, writeScope);
  if (outOfScope) return outOfScope;
  let content: string;
  try {
    content = await fs.readFile(resolved.abs, 'utf8');
  } catch {
    return { ok: false, reason: 'not found', path: relPath };
  }
  const occurrences = content.split(args.oldString).length - 1;
  if (occurrences !== 1) {
    return {
      ok: false,
      reason: occurrences === 0 ? 'oldString not found' : 'oldString is not unique',
      occurrences,
      path: relPath,
    };
  }
  const updated = content.replace(args.oldString, args.newString);
  await fs.writeFile(resolved.abs, updated, 'utf8');
  return { ok: true, path: relPath };
}
