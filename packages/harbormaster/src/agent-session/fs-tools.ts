/**
 * Local filesystem handlers for the closed tool set's read/list/search/
 * write/edit tools (`tools.ts`), bounded to the ticket worktree. `write`
 * and `edit` are a cheap pre-check only — refusing an escape or a
 * `.git`/`.github/workflows`/`.dokima` write before it ever touches disk —
 * not the authoritative scope decision: that is `commit`
 * (`git-tools.ts`'s `commitWithScopeCheck`), which is the only tool that
 * makes anything durable. A file can be drafted here outside write_scope
 * and simply never survive a commit.
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

/** Cheap containment check: no absolute path, no `..` escape out of `cwd`. Symlink-escape is caught by `classifyManifestFile` (read) or at commit time (write/edit). */
export function resolveWithinWorktree(cwd: string, relPath: string): string {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ToolPathEscapeError(relPath);
  }
  return resolved;
}

function refuseIfHardExcluded(relPath: string): { ok: false; reason: string } | null {
  const normalized = relPath.split(path.sep).join('/');
  if (matchesAnyGlob(normalized, HARD_EXCLUSIONS)) {
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
  const realRoot = await fs.realpath(cwd);
  const result = await classifyManifestFile(cwd, realRoot, args.path);
  if (result.status !== 'ok') {
    return { ok: false, status: result.status, path: args.path };
  }
  return { ok: true, path: args.path, content: result.content };
}

export interface ListToolArgs {
  readonly path?: string;
}

export async function listTool(cwd: string, args: ListToolArgs): Promise<unknown> {
  const relPath = args.path ?? '.';
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
  const root = resolveWithinWorktree(cwd, args.path ?? '.');
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
        matches.push({ file: path.relative(cwd, file), line: i + 1, text: lines[i]! });
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

export async function writeTool(cwd: string, args: WriteToolArgs): Promise<unknown> {
  const excluded = refuseIfHardExcluded(args.path);
  if (excluded) return excluded;
  const abs = resolveWithinWorktree(cwd, args.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, args.content, 'utf8');
  return { ok: true, path: args.path };
}

export interface EditToolArgs {
  readonly path: string;
  readonly oldString: string;
  readonly newString: string;
}

export async function editTool(cwd: string, args: EditToolArgs): Promise<unknown> {
  const excluded = refuseIfHardExcluded(args.path);
  if (excluded) return excluded;
  const abs = resolveWithinWorktree(cwd, args.path);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf8');
  } catch {
    return { ok: false, reason: 'not found', path: args.path };
  }
  const occurrences = content.split(args.oldString).length - 1;
  if (occurrences !== 1) {
    return {
      ok: false,
      reason: occurrences === 0 ? 'oldString not found' : 'oldString is not unique',
      occurrences,
      path: args.path,
    };
  }
  const updated = content.replace(args.oldString, args.newString);
  await fs.writeFile(abs, updated, 'utf8');
  return { ok: true, path: args.path };
}
