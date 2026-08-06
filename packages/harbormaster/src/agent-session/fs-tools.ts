/**
 * Local filesystem handlers for the closed tool set's read/list/search/
 * write/edit tools (`tools.ts`), bounded to the ticket worktree. `write`
 * and `edit` are a pre-check only — refusing an escape, a symlink-escape,
 * or a `.git`/`.github/workflows`/`.dokima` write before it ever touches
 * disk — not the authoritative scope decision: that is `commit`
 * (`git-tools.ts`'s `commitWithScopeCheck`), which is the only tool that
 * makes anything durable. A file can be drafted here inside write_scope
 * and simply never survive a commit if it strays outside it.
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

export async function writeTool(cwd: string, args: WriteToolArgs): Promise<unknown> {
  const relPath = normalizeRelPath(args.path);
  const excluded = refuseIfHardExcluded(relPath);
  if (excluded) return excluded;
  const resolved = await resolveOrRefusal(cwd, relPath);
  if ('reason' in resolved) return resolved;
  await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
  await fs.writeFile(resolved.abs, args.content, 'utf8');
  return { ok: true, path: relPath };
}

export interface EditToolArgs {
  readonly path: string;
  readonly oldString: string;
  readonly newString: string;
}

export async function editTool(cwd: string, args: EditToolArgs): Promise<unknown> {
  const relPath = normalizeRelPath(args.path);
  const excluded = refuseIfHardExcluded(relPath);
  if (excluded) return excluded;
  const resolved = await resolveOrRefusal(cwd, relPath);
  if ('reason' in resolved) return resolved;
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
