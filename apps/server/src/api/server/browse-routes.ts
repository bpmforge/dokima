/**
 * browse-routes.ts — the directory picker's server half (W12-42).
 *
 * WHY A SERVER ROUTE AT ALL. `new` no longer asks for a path (W12-41): the
 * server creates the directory, so the location is not information the user
 * has. `onboard` and `import` are the opposite — the directory already exists
 * and where it lives is information ONLY the user has. Until now the way to
 * say so was to type an absolute path from memory.
 *
 * A browser cannot fix that alone. `<input type="file">` yields file contents
 * and a fake path; `webkitdirectory` yields relative paths. On a hosted web
 * app "just add a browse button" is genuinely impossible. Dokima is not a
 * hosted web app: the core is a local, already-authenticated process on the
 * same machine, which already opens arbitrary project directories on request.
 * It can simply `readdir`. This route is the local-first architecture paying
 * for itself, and it is written down here rather than left to be rediscovered.
 *
 * THE SECURITY QUESTION, ANSWERED (T-28, THREAT_MODEL §3.5). A listing
 * endpoint is a filesystem-enumeration surface reachable by anything holding
 * the bearer token. The decision is BOUNDED ROOTS: every listing must resolve
 * under the home directory, the configured workspace root, or the parent of an
 * already-registered project.
 *
 * Rejected — unbounded listing from `/`. The argument for it is that the core
 * already opens any path the user names, so enumeration adds nothing. That is
 * wrong in one specific way: naming a path requires already knowing it, while
 * enumeration DISCOVERS paths. A token that leaks (T-19: DNS-rebinding, CSRF
 * onto localhost) turns from "can act on projects" into "can map the home
 * directory, find ~/.ssh, read the shape of everything". Bounded roots keep
 * the marginal exposure at directories the user has already pointed us at,
 * which is the exposure the product already carries.
 *
 * Also rejected — bounding by prefix string alone. `realpath` is applied to
 * both root and target before the containment check, because `~/Dokima/x`
 * where `x` symlinks to `/` would otherwise pass a `startsWith` test and
 * enumerate the whole disk. The check is on the resolved path.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { loadRegistry } from '../projects/registry-store.js';
import {
  resolveWorkspaceRoot,
  WORKSPACE_ROOT_SETTINGS_KEY,
} from '../projects/workspace-root.js';
import { badRequest, notFound } from './artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { conflict } from './settings-route-helpers.js';
import { getGlobalSettings } from './settings-scope.js';

export interface BrowseRoutesOptions {
  /** Overrides `computeFleetRegistryPath()` — tests only. */
  home?: string;
  /** Overrides the OS home directory — tests only. */
  homeDir?: string;
}

export interface BrowseRoot {
  readonly path: string;
  /** What to call it on screen: a person recognises "Home", not `/Users/x`. */
  readonly label: string;
}

/**
 * `realpath`, extended to paths that do not exist.
 *
 * Plain `realpath` throws on a missing path, and falling back to the input
 * unchanged is not good enough: on macOS `/tmp` is a symlink to `/private/tmp`,
 * so a root resolves to `/private/tmp/...` while a missing child under it stays
 * `/tmp/.../nope`, and the containment check then reports "outside your allowed
 * roots" for what is really "no such directory" — the wrong refusal, and the
 * one that sounds like a security problem. A symlinked home does the same on
 * any platform.
 *
 * So: resolve the nearest ancestor that DOES exist and re-attach the missing
 * tail. Containment is then judged on the same footing for both.
 */
async function realOrSelf(target: string): Promise<string> {
  const absolute = path.resolve(target);
  let head = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(head);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return absolute; // reached the filesystem root
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

/**
 * Containment on RESOLVED paths, with a separator guard so that `/home/bobby`
 * is not treated as living inside root `/home/bob`.
 */
export function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Where the picker OPENS. Acceptance: the common case in two clicks — a picker
 * that starts at `/` and makes someone walk down is a worse version of typing.
 */
export async function browseRoots(opts: {
  registryPath: string;
  homeDir: string;
  workspaceRoot: string;
}): Promise<BrowseRoot[]> {
  const roots: BrowseRoot[] = [
    { path: opts.workspaceRoot, label: 'Dokima projects' },
    { path: opts.homeDir, label: 'Home' },
  ];
  // The parents of registered projects: someone whose work lives in ~/Code has
  // told us so by registering a project there, and should not have to say it
  // again on every subsequent onboard.
  let records: Awaited<ReturnType<typeof loadRegistry>> = [];
  try {
    records = await loadRegistry(opts.registryPath);
  } catch {
    // A missing or unreadable registry means no projects yet, not an error to
    // show a first-time user on the screen where they add their first one.
    records = [];
  }
  for (const record of records) {
    const parent = path.dirname(record.path);
    if (roots.some((r) => r.path === parent)) continue;
    roots.push({ path: parent, label: path.basename(parent) || parent });
  }
  const seen = new Set<string>();
  return roots.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

export interface BrowseEntry {
  readonly name: string;
  readonly path: string;
  /** Already in the fleet — offering it again for onboard is a dead end. */
  readonly registered: boolean;
}

export type BrowseRefusal =
  | 'outside-allowed-roots'
  | 'no-such-directory'
  | 'not-a-directory'
  | 'not-readable';

export interface BrowseListing {
  readonly path: string;
  /** `null` at a root: there is nothing above it the user may look at. */
  readonly parent: string | null;
  readonly entries: BrowseEntry[];
}

/**
 * Every failure mode named rather than collapsed into "could not list". Each
 * of these is something a person can act on and they are not the same act:
 * a wrong path is retyped, an unreadable one is chmod'd, a file is a mis-click,
 * a registered directory is already open somewhere else in the product.
 */
export async function browseDirectory(args: {
  target: string;
  roots: readonly BrowseRoot[];
  registeredPaths: ReadonlySet<string>;
}): Promise<BrowseListing | { refusal: BrowseRefusal; detail: string }> {
  const resolved = await realOrSelf(args.target);

  const realRoots = await Promise.all(
    args.roots.map(async (r) => ({ ...r, real: await realOrSelf(r.path) })),
  );
  const containing = realRoots.find((r) => isWithin(r.real, resolved));
  if (!containing) {
    return {
      refusal: 'outside-allowed-roots',
      detail:
        `${args.target} is outside the directories Dokima will list. ` +
        `Browsing is bounded to your home directory, your workspace root and the ` +
        `folders your existing projects live in. Register a project there, or set ` +
        `a different workspace root in Settings.`,
    };
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      return { refusal: 'not-readable', detail: `${args.target} exists but is not readable.` };
    }
    return { refusal: 'no-such-directory', detail: `${args.target} does not exist.` };
  }
  if (!stat.isDirectory()) {
    return {
      refusal: 'not-a-directory',
      detail: `${args.target} is a file. A project lives in a directory.`,
    };
  }

  let dirents;
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      return { refusal: 'not-readable', detail: `${args.target} exists but is not readable.` };
    }
    throw err;
  }

  // Registered paths are compared on the SAME footing as the entries, which
  // are joined onto a resolved directory. A registry holding `/tmp/x` would
  // otherwise never match an entry at `/private/tmp/x`, and every already-open
  // project would be offered again as if it were free.
  const registeredReal = new Set(
    await Promise.all([...args.registeredPaths].map((p) => realOrSelf(p))),
  );

  const entries: BrowseEntry[] = dirents
    // Directories only: the user is choosing a project, and a list of every
    // file in it is noise they have to read past to find the folder they want.
    // Dot-directories are skipped for the same reason — `.git` and `.dokima`
    // are never the answer, and they crowd out the ones that are.
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => ({
      name: d.name,
      path: path.join(resolved, d.name),
      registered: registeredReal.has(path.join(resolved, d.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(resolved);
  return {
    path: resolved,
    // Stop at the root: an "up" link that leads somewhere the next request
    // will refuse is a control that exists to fail.
    parent: parent !== resolved && isWithin(containing.real, parent) ? parent : null,
    entries,
  };
}

export function registerBrowseRoutes(
  app: FastifyInstance,
  opts: BrowseRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const homeDir = opts.homeDir ?? os.homedir();

  async function currentRoots(): Promise<BrowseRoot[]> {
    const settings = await getGlobalSettings();
    return browseRoots({
      registryPath,
      homeDir,
      workspaceRoot: resolveWorkspaceRoot(settings[WORKSPACE_ROOT_SETTINGS_KEY], homeDir),
    });
  }

  /** Where the picker opens — see `browseRoots`. */
  app.get(
    '/api/v1/browse/roots',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ roots: await currentRoots() });
    },
  );

  app.get('/api/v1/browse', async (request: FastifyRequest, reply: FastifyReply) => {
    const { path: target } = request.query as { path?: string };
    if (typeof target !== 'string' || target.trim() === '') {
      return reply
        .code(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(badRequest(request, 'browse needs a "path" query parameter'));
    }

    const roots = await currentRoots();
    let registered: ReadonlySet<string>;
    try {
      registered = new Set((await loadRegistry(registryPath)).map((r) => r.path));
    } catch {
      registered = new Set();
    }

    const result = await browseDirectory({ target, roots, registeredPaths: registered });
    if ('refusal' in result) {
      if (result.refusal === 'no-such-directory') {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, result.detail));
      }
      // 409 rather than 403 for `outside-allowed-roots`: the caller IS
      // authorised — it holds the token — and the request conflicts with a
      // policy, which is what this product's other refusals already say.
      return reply
        .code(409)
        .type(PROBLEM_CONTENT_TYPE)
        .send(conflict(request, result.detail, result.refusal));
    }
    return reply.send(result);
  });
}
