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
 * SECURITY (symlink-escape, SC-01's fourth enumerated case,
 * docs/SECURITY_CONTROLS.md): a cheap `path.resolve` check alone (no
 * `realpath`) misses an ancestor directory that is itself a symlink
 * pointing outside the worktree — `write {path: 'evil/x.ts'}` where
 * `evil -> /tmp/outside` resolves to a string starting with the worktree
 * root, passes a pure-string check, and would write outside the worktree
 * entirely. `checkWriteScope` (commit time) can't catch this after the
 * fact either — a write that landed outside the worktree never appears in
 * `git diff` at all. `assertRealWithinWorktree` closes this the same way
 * `../scope.js`'s `classifyManifestFile` and `packages/git/src/scope.ts`'s
 * `checkWriteScope` do: walk up to the nearest EXISTING ancestor (the
 * target file may not exist yet — that's the whole point of `write`),
 * resolve it via `fs.realpath`, and check containment on the resolved
 * path, not the literal string.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HARD_EXCLUSIONS, matchesAnyGlob } from '@dokima/git';
import { classifyManifestFile } from '../scope.js';

const MAX_SEARCH_MATCHES = 200;
const SEARCH_SKIP_DIRS = new Set(['.git', 'node_modules']);

export class ToolPathEscapeError extends Error {
  constructor(relPath: string) {
    super(`path "${relPath}" escapes the ticket worktree`);
    this.name = 'ToolPathEscapeError';
  }
}

/** Model-supplied paths are untrusted text, not `git`-normalized input — a leading `./` or a backslash separator would otherwise round-trip inconsistently into a manifest's `files[]` and read like a close-gate bug rather than an unnormalized path (see gateway-session.ts's header). */
export function normalizeRelPath(relPath: string): string {
  const posix = relPath.split(path.sep).join('/');
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

/** Cheap containment check: no absolute path, no `..` escape out of `cwd`. */
export function resolveWithinWorktree(cwd: string, relPath: string): string {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ToolPathEscapeError(relPath);
  }
  return resolved;
}

async function realpathOfNearestAncestor(absPath: string): Promise<string> {
  let dir = path.dirname(absPath);
  const tail = [path.basename(absPath)];
  for (;;) {
    try {
      const realDir = await fs.realpath(dir);
      return path.join(realDir, ...tail);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return absPath;
      tail.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

function isWithinRoot(root: string, real: string): boolean {
  return real === root || real.startsWith(root + path.sep);
}

/** The authoritative pre-write check: `resolveWithinWorktree`'s string arithmetic PLUS realpath-of-nearest-existing-ancestor containment (see module header). Used by `write`/`edit` — the two tools that create durable bytes on disk before a commit ever runs. */
export async function assertRealWithinWorktree(
  cwd: string,
  relPath: string,
): Promise<string> {
  const resolved = resolveWithinWorktree(cwd, relPath);
  const realRoot = await fs.realpath(path.resolve(cwd));
  const real = await realpathOfNearestAncestor(resolved);
  if (!isWithinRoot(realRoot, real)) {
    throw new ToolPathEscapeError(relPath);
  }
  return resolved;
}

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
  const abs = resolveWithinWorktree(cwd, relPath);
  const entries = await fs.readdir(abs, { withFileTypes: true });
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

export interface SearchToolArgs {
  readonly pattern: string;
  readonly path?: string;
}

function toMatcher(pattern: string): (line: string) => boolean {
  try {
    const re = new RegExp(pattern);
    return (line) => re.test(line);
  } catch {
    return (line) => line.includes(pattern);
  }
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
}

export async function searchTool(cwd: string, args: SearchToolArgs): Promise<unknown> {
  const root = resolveWithinWorktree(cwd, normalizeRelPath(args.path ?? '.'));
  const matches: { file: string; line: number; text: string }[] = [];
  const files: string[] = [];
  await walk(root, files);
  const isMatch = toMatcher(args.pattern);
  outer: for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (isMatch(lines[i]!)) {
        matches.push({
          file: normalizeRelPath(path.relative(cwd, file)),
          line: i + 1,
          text: lines[i]!,
        });
        if (matches.length >= MAX_SEARCH_MATCHES) break outer;
      }
    }
  }
  return {
    ok: true,
    pattern: args.pattern,
    matches,
    truncated: matches.length >= MAX_SEARCH_MATCHES,
  };
}

export interface WriteToolArgs {
  readonly path: string;
  readonly content: string;
}

async function resolveOrRefusal(
  cwd: string,
  relPath: string,
): Promise<{ abs: string } | { ok: false; reason: string; path: string }> {
  try {
    return { abs: await assertRealWithinWorktree(cwd, relPath) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason, path: relPath };
  }
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
