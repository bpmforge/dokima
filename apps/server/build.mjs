#!/usr/bin/env node
/**
 * Bundles the server + all 12 workspace packages into one plain-JS file
 * (`apps/server/dist/main.js`) that runs under bare `node`, with no `tsx` and
 * no TypeScript loader. W9-13.
 *
 * Why bundle rather than emit per-package `dist/`s: publishing this monorepo
 * as 13 registry packages means 13 names and lockstep versions on every
 * release. Inlining the workspace graph leaves ONE package to publish, which
 * is also the only shape that can be verified offline (C-1) — a consumer
 * install needs nothing from a registry except the five genuinely-external
 * runtime deps below.
 *
 * Those five stay external on purpose: `better-sqlite3` is a native addon and
 * cannot be inlined at all, and the rest are ordinary runtime dependencies
 * that npm should resolve and dedupe for the consumer rather than being frozen
 * into our bundle. They are declared as `dependencies` of the root package so
 * an install actually gets them — note they currently live in THREE different
 * packages' `node_modules` inside the workspace, which is exactly why a naive
 * bundle-and-ship would have failed at `ERR_MODULE_NOT_FOUND`.
 *
 * Assets (SQL migrations, content packs, the built SPA) are NOT copied here.
 * They ship via the root `package.json`'s `files` list at their existing
 * repo-relative paths, so `resolveAsset()` in `@shipwright/shared` returns the
 * same path from a source checkout and from an installed copy. One layout, no
 * mapping table to keep in sync.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Real runtime dependencies — never inlined. See module header. */
const EXTERNAL = [
  'better-sqlite3',
  'execa',
  'fastify',
  'google-auth-library',
  'zod',
];

const result = await build({
  entryPoints: [path.join(here, 'src', 'bootstrap', 'main.ts')],
  outfile: path.join(here, 'dist', 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  // Matches engines.node ("22.x") and .nvmrc. Bumping one without the others
  // is how you ship syntax the pinned runtime cannot parse.
  target: 'node22',
  external: EXTERNAL,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(
  `bundled -> apps/server/dist/main.js (${(bytes / 1024).toFixed(0)} KB), ` +
    `${result.warnings.length} warning(s), external: ${EXTERNAL.join(', ')}`,
);
