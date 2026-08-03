// conductor-lib/config.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- config ----------
// W9-10: boardPath is the project-relative path to the board file, so a repo
// whose board is not at the root (e.g. Kryptkeeper's docs/board/plan.json)
// can point the conductor at it via conductor.config.json. Default 'plan.json'
// preserves the pre-W9-10 root-board behaviour unchanged for repos (like this
// one) that don't set it.
export const DEFAULT_CONFIG = {
  branchPrefix: 'sw/',
  worktreeDir: '../.dokima-worktrees',
  isolation: 'worktree',
  toolchainMarker: 'package.json',
  boardPath: 'plan.json',
  // W3-15 portability: where THIS project pins its Node version. Dokima
  // pins at the repo root; Kryptkeeper pins at ui/.nvmrc (its CI reads the same
  // file via node-version-file) and has no root .nvmrc. A project that pins
  // nowhere sets this to null, or simply has no such file — the check is then
  // skipped rather than fataling. Same defect class as W9-12's models.json:
  // an unconditional read of a Dokima-shaped path at startup.
  nvmrcPath: '.nvmrc',
  // Warn when a ticket may write implementation but not its test siblings.
  // Off by default (null) so the script stays language-agnostic; a project
  // opts in, e.g. { source: '\\.go$', test: '_test\\.go$' }.
  testSibling: null,
  // Warn when two tickets claim the same versioned-migration number, or when a
  // ticket still to be built claims one that already exists. Off by default:
  // { pattern: '/(\\d{6})_', dirs: ['internal/db/migrations'] }
  migrationVersions: null,
  install: ['pnpm', ['install', '--prefer-offline']],
  gates: [
    ['pnpm', ['lint']],
    ['pnpm', ['typecheck']],
    ['pnpm', ['test']],
  ],
  gateTimeoutMin: 15,
  remotes: ['github', 'origin'],
  alwaysOk: [
    'plan.json',
    'docs/STATUS.md',
    'docs/work/**',
    'docs/TECH_STACK.md',
    'pnpm-lock.yaml',
    'package.json',
  ],
  // W9-12: per-role model routing used to live in a separate scripts/models.json,
  // read unconditionally at module scope — a repo importing only conductor.mjs +
  // conductor-lib.mjs + conductor.config.json crashed with a bare ENOENT before
  // --lint or any argument parsing ran. Folding it in here makes the config
  // self-sufficient: a project's conductor.config.json can override any subset of
  // these via a top-level `models` key (mergeConfig replaces the whole object, same
  // shallow-merge convention as `gates`/`alwaysOk`), or omit `models` entirely and
  // get a working generic ladder out of the box.
  models: {
    maker: 'sonnet',
    cheap: 'haiku',
    reviewer: 'sonnet',
    security: 'sonnet',
    escalate: 'opus',
    cheapLanes: [],
    cheapMaxPoints: 0,
  },
};

/**
 * Validates a resolved `models` config (DEFAULT_CONFIG.models merged with a
 * project's conductor.config.json override) has every role the conductor
 * dispatches sessions to. Returns an array of human-readable problem
 * descriptions — empty when valid. Pure/side-effect-free so the caller
 * decides how to fail (conductor.mjs turns a non-empty result into a startup
 * error naming the missing keys, instead of an undefined-model crash deep
 * inside a session run).
 */
export function validateModels(models) {
  const errors = [];
  if (models === null || typeof models !== 'object') {
    return ["conductor.config.json's \"models\" key must be an object (or omitted to use the built-in default ladder)"];
  }
  for (const role of ['maker', 'cheap', 'reviewer', 'security', 'escalate']) {
    const v = models[role];
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push(`models.${role} is required and must be a non-empty string (got ${JSON.stringify(v)})`);
    }
  }
  return errors;
}

/**
 * Pure claim filter — which tickets may be claimed next, in id order.
 *
 * `excluded` holds ids the CURRENT RUN must not claim again. This is what
 * makes `--no-merge` terminate: a parked ticket's `done` status is committed
 * only on its own branch and never merged, so the board at ROOT still reads
 * `todo`. Without the exclusion the loop re-claims the same ticket forever —
 * and because starting a ticket force-removes and recreates its worktree, each
 * re-claim RESETS the branch to main and destroys the parked work. Observed on
 * Kryptkeeper 2026-07-28: S-01 completed, reviewed APPROVE, parked, was
 * immediately re-claimed, and its three commits became unreachable.
 */

export function nodePinMismatch(nodeVersion, pinContents) {
  const want = String(pinContents ?? '').trim();
  if (!want) return null;
  if (nodeVersion.startsWith(`v${want}.`)) return null;
  return `node ${nodeVersion} != v${want}.x`;
}

/** Shallow-merges a project's conductor.config.json over the defaults (same as the original `{ ...DEFAULT_CONFIG, ...override }`). */
export function mergeConfig(defaults, override) {
  return { ...defaults, ...override };
}

/**
 * Loads conductor.config.json from `root` (project-specific settings) and
 * merges it over `defaults`, or returns `defaults` unchanged when the file
 * doesn't exist. W9-12 follow-up: this used to be an inline IIFE in
 * conductor.mjs with a bare `JSON.parse` — moving the per-role model
 * routing table INTO this same file (W9-12's main fix) meant a hand-edited
 * conductor.config.json with broken JSON (e.g. a trailing comma) threw a raw
 * SyntaxError from the module job at import time, before --lint or any
 * argument parsing ran — the exact failure SHAPE the models.json ENOENT had,
 * just moved one line earlier. Wrapping the parse here and re-throwing a
 * message that names the file and the parser's own reason lets the caller
 * (conductor.mjs) turn it into the same clean startup error + exit(1) it
 * already uses for an invalid `models` value, instead of a stack trace.
 */
export function loadConfigFile(root, defaults, fileName = 'conductor.config.json') {
  const f = resolve(root, fileName);
  if (!existsSync(f)) return defaults;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`${fileName} is not valid JSON: ${e.message}`);
  }
  return mergeConfig(defaults, parsed);
}

/**
 * The shared-infra allowlist a ticket may touch regardless of write_scope,
 * always including the configured board path even when a project's own
 * `alwaysOk` override forgets to list it — the board itself must always be
 * writable by the ticket that updates its own status. De-duplicates so the
 * common case (boardPath left at the default 'plan.json', already first in
 * DEFAULT_CONFIG.alwaysOk) doesn't produce a repeated glob.
 */
export function alwaysOkPatterns(config) {
  const boardPath = config.boardPath ?? 'plan.json';
  return [...new Set([...(config.alwaysOk ?? []), boardPath])];
}

