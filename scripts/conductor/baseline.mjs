// conductor/baseline.mjs — Stage 0 cached baseline preflight (P2-01, Law L6).
//
// Before any ticket is claimed, the configured verify commands run against the
// EXACT base commit in a clean detached worktree. A red baseline blocks the
// run with a distinct blocked_on_baseline status and consumes ZERO ticket
// attempts — the incident review's founding lesson: a pipeline that cannot
// tell a candidate regression from baseline debt charges feature tickets for
// repository health and exhausts them for reasons no coding retry can repair.
//
// The result is cached by everything that could change it — base SHA, the
// normalized command list, the lockfile hash, and the node major version — so
// one expensive suite run serves every ticket sharing that base. Any base
// change invalidates naturally (different key). Cache and evidence live under
// docs/work/ self-gitignored (M-08: evidence never dirties the repository).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { mintReceipt, receiptGaps } from './receipts.mjs';
import { receiptFingerprints } from './fingerprint.mjs';

/** Stable cache key over every input that could change the verdict. */
export function baselineKey({ baseSha, commands, lockfileHash, nodeVersion }) {
  const norm = JSON.stringify(commands);
  const nodeMajor = String(nodeVersion).replace(/^v/, '').split('.')[0];
  return createHash('sha256')
    .update([baseSha, norm, lockfileHash, nodeMajor].join('\n'))
    .digest('hex')
    .slice(0, 24);
}

export function cachePath(cacheDir, key) {
  return resolve(cacheDir, `${key}.json`);
}

export function loadCachedBaseline(cacheDir, key) {
  const p = cachePath(cacheDir, key);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Run the verify commands at baseSha in a clean detached worktree and cache
 * the verdict. Pure-ish core: all side-effecting helpers are injected so the
 * test suite can drive it without a 4-minute suite run.
 *
 * @returns {{green: boolean, gaps: string[], cached: boolean, key: string}}
 */
export function ensureBaseline({
  baseSha,
  commands,
  lockfileHash,
  nodeVersion = process.version,
  cacheDir,
  worktreeDir,
  timeoutMin = 30,
  git,
  install, // injected: git(args[], opts?) -> string; install(wt) -> void (throws on failure)
}) {
  const key = baselineKey({ baseSha, commands, lockfileHash, nodeVersion });
  const cached = loadCachedBaseline(cacheDir, key);
  if (cached && cached.baseSha === baseSha) {
    writeCurrent(cacheDir, cached); // P2-02: keep the pointer fresh on cache hits too
    return {
      green: cached.green,
      gaps: cached.gaps ?? [],
      rows: cached.rows ?? [],
      cached: true,
      key,
    };
  }

  mkdirSync(cacheDir, { recursive: true });
  const gi = resolve(cacheDir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n!.gitignore\n');

  // Clean detached worktree at the exact base — never the main checkout, so a
  // red baseline cannot be an artifact of local state.
  const wt = resolve(worktreeDir, `baseline-${key.slice(0, 8)}`);
  try {
    git(['worktree', 'remove', '--force', wt]);
  } catch {
    /* none prior */
  }
  try {
    rmSync(wt, { recursive: true, force: true });
  } catch {
    /* none prior */
  }
  git(['worktree', 'add', '-q', '--detach', wt, baseSha]);

  let result;
  try {
    install(wt);
    const { receipt } = mintReceipt({
      ticketId: `BASELINE-${key.slice(0, 8)}`,
      wt,
      headSha: baseSha,
      commands,
      receiptsDir: cacheDir,
      timeoutMin,
    });
    const gaps = receiptGaps(receipt, baseSha);
    result = {
      green: gaps.length === 0,
      gaps,
      // P2-02: fingerprinted failure rows — the base half of the
      // base-vs-candidate differential. Empty when green.
      rows: receiptFingerprints(receipt),
      baseSha,
      key,
      verifiedAt: new Date().toISOString(),
    };
  } finally {
    try {
      git(['worktree', 'remove', '--force', wt]);
    } catch {
      /* best effort */
    }
    try {
      rmSync(wt, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  writeFileSync(cachePath(cacheDir, key), JSON.stringify(result, null, 2) + '\n');
  writeCurrent(cacheDir, result);
  return {
    green: result.green,
    gaps: result.gaps,
    rows: result.rows,
    cached: false,
    key,
  };
}

/**
 * CURRENT.json — the pointer runGates() reads to get the base half of the
 * differential without re-deriving the cache key (it lacks the lockfile-hash
 * context the conductor start-up has). Always the most recent verdict.
 */
export function writeCurrent(cacheDir, result) {
  writeFileSync(
    resolve(cacheDir, 'CURRENT.json'),
    JSON.stringify(
      {
        key: result.key,
        baseSha: result.baseSha,
        green: result.green,
        rows: result.rows ?? [],
      },
      null,
      2,
    ) + '\n',
  );
}

export function loadCurrentBaseline(cacheDir) {
  const p = resolve(cacheDir, 'CURRENT.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
