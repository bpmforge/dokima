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
 * file descriptor across the containment check and the read. The prior
 * shape of this code resolved containment via `fs.realpath(path)` and then
 * separately re-opened the same path string with `fs.readFile(path)` — two
 * independent syscalls against a path, with a window between them in which
 * an untrusted verify command (real code from the already-exited session,
 * racing `ln -sf /etc/passwd file; ln -sf orig file` in a loop) could swap
 * the leaf for an escaping symlink and have it silently followed by the
 * second call. Here, once containment is established, the file is opened
 * with `O_NOFOLLOW` on the final path component — an atomic, kernel-level
 * refusal to follow a symlink at that instant — and every subsequent check
 * (fstat) and the read itself go through that SAME held `FileHandle`. The
 * manifest-claimed path string is never re-resolved after the initial
 * `fs.realpath` call: if the leaf has become a symlink by the time the
 * open executes, the open fails closed (ELOOP/EMLINK) rather than
 * following it, regardless of how the timing lands.
 */

import { promises as fs, constants as fsConstants } from 'node:fs';
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
