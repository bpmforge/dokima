/**
 * Worktree containment for the closed tool set's filesystem handlers
 * (`fs-tools.ts`, `fs-search.ts`).
 *
 * SECURITY (symlink-escape, SC-01's fourth enumerated case,
 * docs/SECURITY_CONTROLS.md): a cheap `path.resolve` check alone (no
 * `realpath`) misses two shapes: (1) an ANCESTOR directory that is itself a
 * symlink pointing outside the worktree — `write {path: 'evil/x.ts'}` where
 * `evil -> /tmp/outside` resolves to a string starting with the worktree
 * root, passes a pure-string check, and would write outside the worktree
 * entirely; (2) the LEAF component itself being a pre-existing symlink
 * pointing outside — `write {path: 'evil.txt'}` where `evil.txt ->
 * /tmp/outside/leak.txt` — which `fs.writeFile`'s default `open()` follows
 * (Node has no `O_NOFOLLOW` by default). `checkWriteScope` (commit time)
 * can't catch either after the fact — a write that landed outside the
 * worktree never appears in `git diff` at all.
 *
 * `assertRealWithinWorktree` closes both: `realpathOfTarget` attempts
 * `fs.realpath` on the FULL target first — this resolves a symlink leaf (or
 * chain) whose ultimate target exists, catching case (2) directly, same as
 * `../scope.js`'s `classifyManifestFile` already does for reads. Only when
 * the leaf has no filesystem entry at all (`fs.lstat` also fails — the
 * genuine write-new-file case) does it fall back to
 * `realpathOfNearestAncestor` (walk up to the nearest EXISTING ancestor,
 * same as `packages/git/src/scope.ts`'s `checkWriteScope`), which still
 * catches case (1). A leaf that EXISTS as a symlink but whose target does
 * NOT (a dangling symlink) is a third shape `classifyManifestFile`'s
 * read-only path doesn't need to worry about but a write does: `fs.realpath`
 * throws for it same as a missing leaf, and naively falling back to
 * ancestor-only resolution there would miss it too (the ancestor walk never
 * follows the symlink itself) — the exact "same bug again" this ticket was
 * reopened over. `realpathOfTarget` distinguishes the two via `fs.lstat`
 * before falling back, and manually follows a dangling symlink's own target
 * (`fs.readlink`, recursively, bounded by `MAX_SYMLINK_HOPS`) rather than
 * treating it as an absent leaf.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Bounds `realpathOfTarget`'s manual symlink-chain following (dangling symlinks only — a chain whose target ultimately exists is resolved by a single `fs.realpath` call instead). Refusing past this is a fail-closed default, not a realistic legitimate depth. */
const MAX_SYMLINK_HOPS = 40;

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

/** Fallback for a leaf with NO filesystem entry at all (the write-new-file case) — walks up to the nearest EXISTING ancestor, resolves it via `fs.realpath`, and rejoins the unresolved tail. Never called on a leaf that exists as a symlink (see `realpathOfTarget`, its only caller). */
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

/**
 * Resolves `absPath` to its real location, covering all three shapes a
 * write-time containment check must (module header): an ordinary existing
 * file (`fs.realpath` resolves it directly); a symlink leaf whose ultimate
 * target exists (`fs.realpath` already follows the whole chain); and a
 * dangling symlink leaf, which `fs.realpath` throws on same as a genuinely
 * absent leaf — distinguished here via `fs.lstat` and resolved by manually
 * following the link (`fs.readlink`) rather than falling back to
 * ancestor-only resolution, which would silently ignore the symlink and
 * miss the escape.
 */
async function realpathOfTarget(absPath: string, hops = 0): Promise<string> {
  try {
    return await fs.realpath(absPath);
  } catch (err) {
    const isSymlink = await fs
      .lstat(absPath)
      .then((stat) => stat.isSymbolicLink())
      .catch(() => null);

    if (isSymlink === null) {
      // The leaf has no filesystem entry at all — the genuine
      // write-new-file case. Safe to resolve via the nearest existing
      // ancestor instead.
      return realpathOfNearestAncestor(absPath);
    }
    if (!isSymlink) {
      // Exists, is not a symlink, yet `fs.realpath` still failed (e.g. a
      // permissions error) — fail closed by surfacing the original error
      // rather than mislabeling it as a path escape.
      throw err;
    }
    if (hops >= MAX_SYMLINK_HOPS) {
      throw new ToolPathEscapeError(absPath);
    }
    const link = await fs.readlink(absPath);
    const target = path.isAbsolute(link)
      ? link
      : path.resolve(path.dirname(absPath), link);
    return realpathOfTarget(target, hops + 1);
  }
}

function isWithinRoot(root: string, real: string): boolean {
  return real === root || real.startsWith(root + path.sep);
}

export interface ResolvedPath {
  /** The surface-resolved absolute path (`resolveWithinWorktree`'s string arithmetic, symlinks unresolved) — what `write`/`edit` actually operate on; the OS follows any ancestor symlink transparently when the write lands. */
  abs: string;
  /**
   * The fully-resolved (realpath'd) target, worktree-root-relative and
   * posix-separated — where the write actually lands once every ancestor
   * symlink is followed (W11-19). `abs`'s literal text can read as an
   * ordinary in-scope path while `realRelPath` reveals it resolves into
   * `.git` or another excluded/out-of-scope location via an ancestor
   * symlink that is itself legitimately inside the worktree (so
   * containment alone can't catch it — see module header).
   */
  realRelPath: string;
}

/** The authoritative pre-write check: `resolveWithinWorktree`'s string arithmetic PLUS full-target-realpath containment (see module header). Used by `write`/`edit`/`list`/`search` — every tool that touches the real filesystem before a `commit` ever runs. */
export async function assertRealWithinWorktree(
  cwd: string,
  relPath: string,
): Promise<ResolvedPath> {
  const resolved = resolveWithinWorktree(cwd, relPath);
  const realRoot = await fs.realpath(path.resolve(cwd));
  const real = await realpathOfTarget(resolved);
  if (!isWithinRoot(realRoot, real)) {
    throw new ToolPathEscapeError(relPath);
  }
  const realRelPath = path.relative(realRoot, real).split(path.sep).join('/');
  return { abs: resolved, realRelPath };
}

/** Shared refusal shape for every tool that must not throw a raw exception back through the mcp executor (see `mcp-wiring.ts`'s `runOneToolCall`) — a refused path is data the model can act on, not a session crash. */
export async function resolveOrRefusal(
  cwd: string,
  relPath: string,
): Promise<ResolvedPath | { ok: false; reason: string; path: string }> {
  try {
    return await assertRealWithinWorktree(cwd, relPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason, path: relPath };
  }
}
