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

/**
 * SECURITY (ReDoS, SC-18): `search`'s `pattern` is model-supplied and the
 * schema documents regex support, so a catastrophic-backtracking pattern
 * (`(a+)+$`, `(a|a)+$`) is trivially reachable by design. JS regex
 * execution is synchronous on the single harbormaster event loop and
 * nothing upstream (`requestToolCall` in packages/mcp) wraps a tool call
 * in a timeout, so a single pathological `search` call can hang the whole
 * process forever — including past T-27's own iteration cap, since a
 * hung call never returns to let the loop count the turn. Three bounds,
 * matching the timeout discipline `reRunVerify` gives `verify`:
 * (1) `isUnsafeSearchPattern` statically refuses the nested-quantifier/
 * overlapping-alternation shapes behind every well-known catastrophic
 * pattern before a regex is ever constructed — `toMatcher` falls back to
 * literal-substring matching for anything refused, same as it already
 * does for a syntactically invalid pattern; (2) `MAX_MATCH_LINE_LENGTH`
 * caps the input handed to any one `.test()` call, bounding even a
 * pattern the heuristic misses; (3) `SEARCH_TIME_BUDGET_MS` is a
 * wall-clock budget checked between lines, bounding the call's *total*
 * time across many files/lines (it cannot interrupt a single hung
 * `.test()` call already in progress — bound (1) is what prevents that).
 */
const MAX_PATTERN_LENGTH = 200;
const MAX_MATCH_LINE_LENGTH = 4000;
const SEARCH_TIME_BUDGET_MS = 3000;
const TIME_CHECK_INTERVAL_LINES = 200;

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

/**
 * Conservative static heuristic: true if `pattern` contains a quantified
 * group — `(...)+`, `(...)*`, `(...){n,}` — whose body itself contains
 * another quantifier or an alternation (`*`, `+`, `{`, `|`), the shape
 * behind every well-known catastrophic-backtracking example. Deliberately
 * errs toward over-rejecting an unusual-but-safe pattern over
 * under-rejecting a dangerous one: a false positive costs `toMatcher`
 * precision (it falls back to literal-substring matching), never safety.
 * Content inside a `[...]` character class is exempt — `[+*|]` is a
 * literal class, not a quantifier.
 */
export function isUnsafeSearchPattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return true;
  let inClass = false;
  const groupBodyRisky: boolean[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      groupBodyRisky.push(false);
      continue;
    }
    if (ch === ')') {
      const bodyRisky = groupBodyRisky.pop() ?? false;
      const next = pattern[i + 1];
      const quantified = next === '*' || next === '+' || next === '{';
      if (quantified && bodyRisky) return true;
      if (bodyRisky && groupBodyRisky.length > 0) {
        groupBodyRisky[groupBodyRisky.length - 1] = true;
      }
      continue;
    }
    if (ch === '*' || ch === '+' || ch === '{' || ch === '|') {
      if (groupBodyRisky.length > 0) groupBodyRisky[groupBodyRisky.length - 1] = true;
    }
  }
  return false;
}

function toMatcher(pattern: string): (line: string) => boolean {
  if (isUnsafeSearchPattern(pattern)) {
    return (line) => line.includes(pattern);
  }
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
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  let linesSinceTimeCheck = 0;
  let timedOut = false;
  outer: for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      linesSinceTimeCheck += 1;
      if (linesSinceTimeCheck >= TIME_CHECK_INTERVAL_LINES) {
        linesSinceTimeCheck = 0;
        if (Date.now() >= deadline) {
          timedOut = true;
          break outer;
        }
      }
      const line = lines[i]!;
      if (line.length > MAX_MATCH_LINE_LENGTH) continue;
      if (isMatch(line)) {
        matches.push({
          file: normalizeRelPath(path.relative(cwd, file)),
          line: i + 1,
          text: line,
        });
        if (matches.length >= MAX_SEARCH_MATCHES) break outer;
      }
    }
  }
  return {
    ok: true,
    pattern: args.pattern,
    matches,
    truncated: matches.length >= MAX_SEARCH_MATCHES || timedOut,
    timedOut,
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
