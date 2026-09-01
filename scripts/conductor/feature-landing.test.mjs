// feature-landing.test.mjs — P6-02: one merge per feature. RED provenance:
// 22 of 30 first-parent commits were per-ticket merges (measured); the
// acceptance's own negatives — partial features never land, drift refuses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { featureOf, featuresReadyToLand, landFeature } from './feature-landing.mjs';
import { composeWave, buildSyntheticBranch, waveInvalidation } from './wave.mjs';

const T = (id, over = {}) => ({
  id,
  title: id,
  lane: 'x',
  write_scope: [`src/${id}/**`],
  depends_on: [],
  acceptance: ['a'],
  points: 2,
  status: 'todo',
  ...over,
});

describe('featureOf (P6-02)', () => {
  it('board features[] wins; wave prefix is the structural fallback', () => {
    const features = [{ id: 'F-US-1', tickets: ['W1-01', 'W1-02'] }];
    expect(featureOf(T('W1-01'), features)).toBe('F-US-1');
    expect(featureOf(T('W2-09'), features)).toBe('W:W2');
  });

  it('resolves on the REAL pipeline board: every ticket gets a feature id (fallback cohorts today)', async () => {
    const { readFileSync } = await import('node:fs');
    const plan = JSON.parse(
      readFileSync(
        new URL('../../docs/work/pipeline-board.json', import.meta.url),
        'utf8',
      ),
    );
    for (const t of plan.tickets) expect(featureOf(t, plan.features ?? [])).toBeTruthy();
  });
});

describe('featuresReadyToLand (P6-02)', () => {
  it('a feature lands only whole: all-parked = ready; any open ticket = waiting', () => {
    const boardTickets = [T('W1-01'), T('W1-02'), T('W2-01')];
    const parked = [
      { id: 'W1-01', branch: 'sw/w1-01', headSha: 'a'.repeat(40) },
      { id: 'W2-01', branch: 'sw/w2-01', headSha: 'b'.repeat(40) },
    ];
    const { ready, waiting } = featuresReadyToLand({ parked, boardTickets });
    expect(ready.map((r) => r.featureId)).toEqual(['W:W2']);
    expect(waiting[0]).toMatchObject({ featureId: 'W:W1', openTickets: ['W1-02'] });
  });

  it('an already-DONE non-parked member does not hold a feature hostage', () => {
    const boardTickets = [T('W1-01'), T('W1-02', { status: 'done' })];
    const parked = [{ id: 'W1-01', branch: 'sw/w1-01', headSha: 'a'.repeat(40) }];
    const { ready } = featuresReadyToLand({ parked, boardTickets });
    expect(ready.map((r) => r.featureId)).toEqual(['W:W1']);
  });

  it('a BLOCKED member holds the whole feature in WAITING — half a feature never lands (Challenger finding 5)', () => {
    const boardTickets = [T('W1-01'), T('W1-02', { status: 'blocked' }), T('W1-03')];
    const parked = [
      { id: 'W1-01', branch: 'sw/w1-01', headSha: 'a'.repeat(40) },
      { id: 'W1-03', branch: 'sw/w1-03', headSha: 'b'.repeat(40) },
    ];
    const { ready, waiting } = featuresReadyToLand({ parked, boardTickets });
    expect(ready).toHaveLength(0);
    expect(waiting[0].openTickets).toContain('W1-02');
  });
});

describe('landFeature on a real repo (P6-02) — ONE merge per feature', () => {
  let repo, wtBase;
  const g = (args, opts = {}) =>
    execFileSync('git', args, {
      cwd: opts.cwd ?? repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commit = (msg, cwd = repo) =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg],
      { cwd },
    );
  const mkBranch = (name, file) => {
    g(['checkout', '-q', '-b', name, 'main']);
    mkdirSync(join(repo, file.split('/')[0]), { recursive: true });
    writeFileSync(join(repo, file), `${name}\n`);
    g(['add', '.']);
    commit(name);
    const sha = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    return sha;
  };
  const realDeps = () => ({
    composeWave,
    buildSyntheticBranch,
    waveInvalidation,
    verifySynthetic: () => ({ green: true }),
    waveCfg: { maxTickets: 8, maxChangedLines: 10000 },
    worktreeDir: wtBase,
    gitRun: (a, o) => g(a, o),
  });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'feat-land-'));
    wtBase = mkdtempSync(join(tmpdir(), 'feat-wt-'));
    g(['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    g(['add', '.']);
    commit('base');
  });
  afterEach(() => {
    for (const d of [repo, wtBase]) rmSync(d, { recursive: true, force: true });
  });

  it('two parked tickets land as EXACTLY ONE merge commit on main', async () => {
    const shaA = mkBranch('sw/a', 'a/f.txt');
    const shaB = mkBranch('sw/b', 'b/f.txt');
    const boardTickets = [
      T('A', { write_scope: ['a/**'] }),
      T('B', { write_scope: ['b/**'] }),
    ];
    const before = g(['rev-list', '--count', '--first-parent', 'main']).trim();
    const r = await landFeature({
      featureId: 'F-US-1',
      members: [
        { id: 'A', branch: 'sw/a', headSha: shaA },
        { id: 'B', branch: 'sw/b', headSha: shaB },
      ],
      boardTickets,
      deps: realDeps(),
    });
    expect(r.landed).toBe(true);
    const after = g(['rev-list', '--count', '--first-parent', 'main']).trim();
    expect(Number(after) - Number(before)).toBe(1); // ONE first-parent merge
    expect(g(['log', '-1', '--format=%s', 'main'])).toContain(
      'Merge feature F-US-1: 2 ticket(s)',
    );
    const tree = g(['ls-tree', '-r', '--name-only', 'main']).trim().split('\n');
    expect(tree).toContain('a/f.txt');
    expect(tree).toContain('b/f.txt');
  });

  it('a member that moved after the wave REFUSES the landing; main untouched', async () => {
    const shaA = mkBranch('sw/ma', 'ma/f.txt');
    // move the branch after "testing"
    g(['checkout', '-q', 'sw/ma']);
    writeFileSync(join(repo, 'ma/late.txt'), 'late\n');
    g(['add', '.']);
    commit('late');
    g(['checkout', '-q', 'main']);
    const r = await landFeature({
      featureId: 'F-X',
      members: [{ id: 'MA', branch: 'sw/ma', headSha: shaA }],
      boardTickets: [T('MA', { write_scope: ['ma/**'] })],
      deps: realDeps(),
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('moved after the wave passed');
    expect(g(['rev-list', '--count', '--first-parent', 'main']).trim()).toBe('1');
  });

  it('a RED Tier-D verify on the synthetic head refuses the landing', async () => {
    const shaA = mkBranch('sw/ra', 'ra/f.txt');
    const deps = {
      ...realDeps(),
      verifySynthetic: () => ({ green: false, detail: 'pnpm test exit 1' }),
    };
    const r = await landFeature({
      featureId: 'F-R',
      members: [{ id: 'RA', branch: 'sw/ra', headSha: shaA }],
      boardTickets: [T('RA', { write_scope: ['ra/**'] })],
      deps,
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('verify RED');
  });

  it('an open seam gap refuses the landing whole (Tier-D preamble reused)', async () => {
    const shaA = mkBranch('sw/sa', 'sa/f.txt');
    const deps = {
      ...realDeps(),
      seamGapsFor: async () => [
        'Tier-D seam gap [@x#y] (consumer SA): declared and never wired',
      ],
    };
    const r = await landFeature({
      featureId: 'F-S',
      members: [{ id: 'SA', branch: 'sw/sa', headSha: shaA }],
      boardTickets: [T('SA', { write_scope: ['sa/**'] })],
      deps,
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('seam gate open');
  });
});
