/**
 * Where the shipped, non-code assets live: SQL migrations, the content packs
 * (experts/validators/guide), the built SPA, the fitness fixtures.
 *
 * Every consumer of these used to resolve them by walking up from its own
 * `import.meta.url` -- `path.resolve(here, '../../../../content/experts')` and
 * friends. That is correct while the code runs from source and wrong the moment
 * it is bundled, because a bundle collapses thirteen different source
 * directories into one file: `import.meta.url` becomes the bundle's own path
 * and every one of those `..` hops lands somewhere arbitrary. Verified rather
 * than assumed (W9-13, 2026-07-30): the first bundled run died with
 * `ENOENT ... scandir <bundle-dir>/migrations` before it could open the DB.
 *
 * So the depth-counting is replaced by a single anchored lookup: find the root
 * of the distribution, then join the SAME repo-relative path the call site used
 * before. The packaged tarball deliberately preserves the repo's own layout
 * (`packages/events/migrations`, `content/experts`, `apps/web/dist`), so those
 * relative paths are byte-identical in both worlds and there is no second
 * layout to keep in sync.
 *
 * The anchor is the root `package.json`'s name. It ships inside the package, so
 * the same probe works from source and from an installed copy; `@dokima/*`
 * package manifests are skipped by name, so a call site inside `packages/shared`
 * walks past its own manifest to the real root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root `package.json` name -- the marker that identifies the distribution root. */
const ROOT_PACKAGE_NAME = 'dokima';

/** Guard against walking to `/` on a malformed install. */
const MAX_ASCENT = 12;

let cached: string | null = null;

export class DistributionRootNotFoundError extends Error {
  constructor(startedFrom: string) {
    super(
      `could not locate the Dokima distribution root: no package.json named ` +
        `"${ROOT_PACKAGE_NAME}" found within ${MAX_ASCENT} directories above ${startedFrom}. ` +
        `Set DOKIMA_DIST_ROOT to override.`,
    );
    this.name = 'DistributionRootNotFoundError';
  }
}

function isRootManifest(dir: string): boolean {
  const manifest = path.join(dir, 'package.json');
  if (!fs.existsSync(manifest)) return false;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { name?: unknown }).name === ROOT_PACKAGE_NAME
    );
  } catch {
    // A malformed package.json higher up the tree must not abort the search --
    // it is not necessarily ours. Keep ascending.
    return false;
  }
}

/**
 * The directory containing the root `package.json`: the monorepo root when
 * running from source, the installed package root when running from the bundle.
 *
 * `DOKIMA_DIST_ROOT` overrides the probe entirely (tests, unusual installs).
 * The result is cached because this sits on hot-ish paths (every migration run,
 * every roster read) and the answer cannot change within a process.
 */
export function distributionRoot(): string {
  const override = process.env.DOKIMA_DIST_ROOT;
  if (override !== undefined && override !== '') return path.resolve(override);

  if (cached !== null) return cached;

  const startedFrom = path.dirname(fileURLToPath(import.meta.url));
  let dir = startedFrom;
  for (let i = 0; i < MAX_ASCENT; i++) {
    if (isRootManifest(dir)) {
      cached = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new DistributionRootNotFoundError(startedFrom);
}

/**
 * Resolve a distribution asset from its repo-relative path, e.g.
 * `resolveAsset('content', 'experts')`. Segments are the same ones the call
 * site would have written after its `..` hops, which is what makes this a
 * mechanical substitution rather than a re-layout.
 */
export function resolveAsset(...segments: string[]): string {
  return path.join(distributionRoot(), ...segments);
}

/** Test seam: drop the memoized root so a test can re-probe under a new env. */
export function resetDistributionRootCache(): void {
  cached = null;
}
