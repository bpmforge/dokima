// baseline.test.mjs — P2-01 red/green suite for the Stage 0 baseline
// preflight. Uses injected git/install fakes plus real temp-git worktrees so
// no test pays for a 4-minute suite run. RED provenance: pre-ticket the
// conductor had no baseline concept at all — a red base charged feature
// tickets (the incident review's founding defect).

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  baselineKey,
  ensureBaseline,
  loadCachedBaseline,
  cachePath,
} from './baseline.mjs';

const NODE = process.execPath;
const OK = [[NODE, ['-e', 'process.exit(0)']]];
const FAIL = [[NODE, ['-e', "console.error('suite is red on base'); process.exit(1)"]]];

function tempGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-repo-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  g('add', '.');
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'],
    { cwd: dir },
  );
  return { dir, sha: g('rev-parse', 'HEAD'), g };
}

function harness(commands) {
  const { dir, sha } = tempGitRepo();
  const cacheDir = mkdtempSync(join(tmpdir(), 'baseline-cache-'));
  const worktreeDir = mkdtempSync(join(tmpdir(), 'baseline-wt-'));
  const installs = [];
  const args = {
    baseSha: sha,
    commands,
    lockfileHash: 'lock123',
    nodeVersion: 'v22.23.1',
    cacheDir,
    worktreeDir,
    git: (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim(),
    install: (wt) => installs.push(wt),
  };
  const cleanup = () => {
    for (const d of [dir, cacheDir, worktreeDir])
      rmSync(d, { recursive: true, force: true });
  };
  return { args, installs, cacheDir, sha, cleanup };
}

describe('baselineKey (P2-01)', () => {
  const base = {
    baseSha: 'a'.repeat(40),
    commands: OK,
    lockfileHash: 'l1',
    nodeVersion: 'v22.23.1',
  };

  it('changes when any input changes, and only then', () => {
    const k = baselineKey(base);
    expect(baselineKey(base)).toBe(k); // stable
    expect(baselineKey({ ...base, baseSha: 'b'.repeat(40) })).not.toBe(k);
    expect(baselineKey({ ...base, commands: FAIL })).not.toBe(k);
    expect(baselineKey({ ...base, lockfileHash: 'l2' })).not.toBe(k);
    expect(baselineKey({ ...base, nodeVersion: 'v24.1.0' })).not.toBe(k);
    expect(baselineKey({ ...base, nodeVersion: 'v22.99.0' })).toBe(k); // same major
  });
});

describe('ensureBaseline (P2-01)', () => {
  let h;
  beforeEach(() => {
    h = null;
  });

  it('GREEN baseline verifies in a detached worktree and caches the verdict', () => {
    h = harness(OK);
    try {
      const r1 = ensureBaseline(h.args);
      expect(r1.green).toBe(true);
      expect(r1.cached).toBe(false);
      expect(h.installs).toHaveLength(1); // install ran in the temp worktree
      expect(existsSync(cachePath(h.cacheDir, r1.key))).toBe(true);
      // Second run: pure cache hit — no worktree, no install, no commands.
      const r2 = ensureBaseline(h.args);
      expect(r2.cached).toBe(true);
      expect(r2.green).toBe(true);
      expect(h.installs).toHaveLength(1); // still one — nothing re-ran
    } finally {
      h.cleanup();
    }
  });

  it('RED baseline reports gaps with the failing output and caches red too', () => {
    h = harness(FAIL);
    try {
      const r = ensureBaseline(h.args);
      expect(r.green).toBe(false);
      expect(r.gaps.some((g) => g.includes('suite is red on base'))).toBe(true);
      // Red is cached as red: rerunning without a base change must not
      // silently go green (and must not re-pay the suite).
      const r2 = ensureBaseline(h.args);
      expect(r2.cached).toBe(true);
      expect(r2.green).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it('a different base SHA misses the cache (natural invalidation)', () => {
    h = harness(OK);
    try {
      const r1 = ensureBaseline(h.args);
      // add a new commit so the sha really differs
      writeFileSync(join(h.args.git(['rev-parse', '--show-toplevel']), 'b.txt'), 'y\n');
      h.args.git(['add', '.']);
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'two'],
        { cwd: h.args.git(['rev-parse', '--show-toplevel']) },
      );
      const r2 = ensureBaseline({
        ...h.args,
        baseSha: h.args.git(['rev-parse', 'HEAD']),
      });
      expect(r2.cached).toBe(false);
      expect(r2.key).not.toBe(r1.key);
    } finally {
      h.cleanup();
    }
  });

  it('cleans up its detached worktree even when install throws (infra, not baseline)', () => {
    h = harness(OK);
    try {
      const boom = {
        ...h.args,
        install: () => {
          throw new Error('ENOSPC: no space left on device');
        },
      };
      expect(() => ensureBaseline(boom)).toThrow(/ENOSPC/);
      // No stale baseline-* worktree left behind
      const leftovers = execFileSync('ls', [h.args.worktreeDir], {
        encoding: 'utf8',
      }).trim();
      expect(leftovers).toBe('');
      // And nothing was cached — an infra crash is not a verdict.
      expect(loadCachedBaseline(h.cacheDir, baselineKey(h.args))).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it('cache dir self-gitignores (M-08)', () => {
    h = harness(OK);
    try {
      ensureBaseline(h.args);
      expect(readFileSync(join(h.cacheDir, '.gitignore'), 'utf8')).toContain('*');
    } finally {
      h.cleanup();
    }
  });
});
