/**
 * Symlink-safe containment for manifest-claimed paths (the W1-07
 * symlink-escape class, BLUEPRINT §3.6/SC-01). Mirrors
 * `packages/git/src/scope.ts`'s `resolvesWithinRoot` — that primitive is
 * private to the git package and also enforces `write_scope` glob
 * membership; this one exists purely to classify (and, having verified
 * containment, read) a Completion Manifest's claimed files against the
 * real worktree root, so a symlink inside the worktree pointing outside it
 * is caught by the close gate (`loop-gates.ts`) before it is ever stat-ed,
 * read, or hashed into a receipt.
 *
 * SECURITY (HIGH, review-caught TOCTOU): `classifyManifestFile` holds ONE
 * file descriptor across the containment check and the read, and never
 * trusts a bare path string again once that fd is open.
 *
 * The leaf is protected by `O_NOFOLLOW` on the final path component: if an
 * untrusted verify command (racing `ln -sf /etc/passwd file; ln -sf orig
 * file` in a loop) swaps the leaf for an escaping symlink between the
 * initial `fs.realpath` check and the open, the open fails closed
 * (ELOOP/EMLINK) rather than following it.
 *
 * `O_NOFOLLOW` only guards the trailing component, though — it does nothing
 * for an ANCESTOR directory swapped to a symlink in that same window, since
 * a normal path lookup always follows symlinks in intermediate components.
 * Closing that gap would ideally mean verifying containment from the fd
 * itself (Linux's `/proc/self/fd/<n>` readlink, or per-component `openat`).
 * Neither is available portably from pure Node: verified empirically that
 * macOS's `/dev/fd/<n>` does not dereference to a real path (`realpath` on
 * it returns itself) and does not support the `/proc/self/fd/<n>/subpath`
 * relative-open trick Linux's magic-link supports, and `node:fs` exposes no
 * `openat`. So `fdStillWithinRoot` (below) approximates it with two fd- and
 * lstat-based checks run AFTER the open, immediately before the read: an
 * ancestor lstat walk (catches an ancestor that is a symlink at
 * verification time) plus an fstat-vs-lstat identity comparison (catches an
 * ancestor that was swapped to an escaping symlink and swapped back before
 * the walk ran — the fd, pinned at open time, still shows the escaped
 * identity even after the path is restored). Together with the leaf's
 * `O_NOFOLLOW`, every instant from open to read is covered; the manifest
 * path string itself is never re-resolved and trusted blindly again.
 */

import { promises as fs, constants as fsConstants, type Stats } from 'node:fs';
import path from 'node:path';

export type ManifestFileStatus = 'ok' | 'missing' | 'symlink-escape';

export interface ManifestFileRead {
  readonly status: ManifestFileStatus;
  /** Populated only when `status === 'ok'` — read from the same fd that verified containment. */
  readonly content: string | null;
}

export interface ClassifyManifestFileOptions {
  /**
   * Test-only seam: invoked once, immediately after the initial
   * `fs.realpath` containment check and immediately before the
   * containment-verifying fd is opened. Lets tests deterministically
   * inject a symlink swap into the exact TOCTOU window this function
   * closes (acceptance 3) instead of relying on real-world race timing.
   * Production callers never pass this.
   */
  afterRealpathBeforeOpen?: () => Promise<void> | void;
  /**
   * Test-only seam: invoked once, after the fd is open (and its `O_NOFOLLOW`
   * leaf check has already passed) but immediately before `fdStillWithinRoot`
   * re-verifies containment. Lets tests deterministically inject a
   * swap-then-restore of an ancestor directory into the narrower window
   * `fdStillWithinRoot`'s fstat/lstat identity check (rather than its
   * ancestor walk) is meant to catch. Production callers never pass this.
   */
  afterOpenBeforeContainmentRecheck?: () => Promise<void> | void;
}

/**
 * `fs.realpath` throws on a path that doesn't exist (a missing file, or a
 * dangling symlink). Walk up to the nearest existing ancestor, resolve
 * *that*, and rejoin the unresolved tail — this still surfaces an escape
 * via a symlinked ancestor directory even though the leaf itself is absent.
 */
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

function isWithinRoot(realRoot: string, real: string): boolean {
  const relative = path.relative(realRoot, real);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Re-verifies, using the already-open `handle` plus fresh `lstat` calls, that
 * the fd still refers to something inside `realRoot`. See the module-level
 * comment for why this is two checks rather than one atomic fd-to-path
 * syscall: no portable primitive for that exists in pure Node.
 */
async function fdStillWithinRoot(
  handle: fs.FileHandle,
  real: string,
  realRoot: string,
): Promise<boolean> {
  let dir = path.dirname(real);
  for (;;) {
    const relative = path.relative(realRoot, dir);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) break;
    let ancestorStat: Stats;
    try {
      ancestorStat = await fs.lstat(dir);
    } catch {
      // An ancestor vanishing mid-check is itself a sign the ground shifted
      // under us — fail closed rather than assume containment holds.
      return false;
    }
    if (ancestorStat.isSymbolicLink()) return false;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const [fdStat, pathStat] = await Promise.all([
    handle.stat(),
    fs.lstat(real).catch(() => null),
  ]);
  if (!pathStat) return false;
  return fdStat.dev === pathStat.dev && fdStat.ino === pathStat.ino;
}

/**
 * Resolves one worktree-relative, manifest-claimed path through
 * `fs.realpath`, verifies containment via a single held file descriptor
 * opened `O_NOFOLLOW`, and — only for a contained, ordinary file — reads
 * its bytes from that SAME descriptor. Returns `symlink-escape` (never
 * `ok`) the instant resolution lands outside `realRoot`, whether the
 * escaping component is the leaf or an ancestor directory, or if the leaf
 * turns out to be a symlink (or anything other than a regular file) at
 * open time.
 */
export async function classifyManifestFile(
  worktreeRoot: string,
  realRoot: string,
  file: string,
  options?: ClassifyManifestFileOptions,
): Promise<ManifestFileRead> {
  const absPath = path.join(worktreeRoot, file);

  let real: string;
  try {
    real = await fs.realpath(absPath);
  } catch {
    const nearest = await realpathOfNearestAncestor(absPath);
    return isWithinRoot(realRoot, nearest)
      ? { status: 'missing', content: null }
      : { status: 'symlink-escape', content: null };
  }

  if (!isWithinRoot(realRoot, real)) {
    // Refused before anything is opened — never touch a path we've
    // already determined resolves outside the root.
    return { status: 'symlink-escape', content: null };
  }

  if (options?.afterRealpathBeforeOpen) await options.afterRealpathBeforeOpen();

  // From here, operate ONLY on `real` (the fully-dereferenced target)
  // through a single fd — never `absPath` again. `real`'s own final
  // component is a regular file per `fs.realpath`'s contract, so
  // `O_NOFOLLOW` here only trips if it was swapped for a symlink in the
  // instant since the resolution above — caught below, never followed.
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'missing', content: null };
    if (code === 'ELOOP' || code === 'EMLINK') {
      return { status: 'symlink-escape', content: null };
    }
    throw err;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return { status: 'symlink-escape', content: null };
    }
    if (options?.afterOpenBeforeContainmentRecheck) {
      await options.afterOpenBeforeContainmentRecheck();
    }
    // `O_NOFOLLOW` above only guards `real`'s trailing component — it says
    // nothing about an ancestor directory swapped to a symlink in the same
    // window. Re-verify via the held fd before trusting the read.
    if (!(await fdStillWithinRoot(handle, real, realRoot))) {
      return { status: 'symlink-escape', content: null };
    }
    const content = await handle.readFile('utf8');
    return { status: 'ok', content };
  } finally {
    await handle.close();
  }
}

/**
 * Classifies every manifest-claimed file against the worktree's real root
 * in one pass. The close gate refuses on any `symlinkEscapes` entry — and
 * on any `missing` entry — before the file is stat-ed for existence, read
 * for receipt hashing, or otherwise trusted.
 */
export async function classifyManifestFiles(
  worktreeRoot: string,
  files: readonly string[],
): Promise<{ missing: string[]; symlinkEscapes: string[] }> {
  const realRoot = await fs.realpath(worktreeRoot);
  const missing: string[] = [];
  const symlinkEscapes: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      const result = await classifyManifestFile(worktreeRoot, realRoot, file);
      if (result.status === 'missing') missing.push(file);
      else if (result.status === 'symlink-escape') symlinkEscapes.push(file);
    }),
  );
  return { missing, symlinkEscapes };
}
