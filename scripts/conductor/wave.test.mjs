// wave.test.mjs — P3-01: synthetic wave composition + build + invalidation.
// RED provenance: no wave concept existed; the acceptance's two negatives
// (dirty-tree refusal, single-member invalidation) are asserted directly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  composeWave,
  buildSyntheticBranch,
  waveInvalidation,
  scopesOverlap,
} from './wave.mjs';

const CFG = {
  maxTickets: 3,
  maxChangedLines: 100,
  highRiskGlobs: ['^packages/events/'],
  highRiskMax: 1,
};
const cand = (id, over = {}) => ({
  id,
  branch: `sw/${id.toLowerCase()}`,
  write_scope: [`src/${id}/**`],
  points: 2,
  changedLines: 10,
  dependsOn: [],
  headSha: 'a'.repeat(40),
  ...over,
});

describe('composeWave (P3-01, OPT-12)', () => {
  it('admits disjoint, dep-satisfied candidates and reports every exclusion WITH a reason', () => {
    const r = composeWave(
      [
        cand('A'),
        cand('B'),
        cand('C', { dependsOn: ['Z'] }),
        cand('D', { write_scope: ['src/A/x.ts'] }),
      ],
      CFG,
    );
    expect(r.members.map((m) => m.id)).toEqual(['A', 'B']);
    expect(r.excluded.find((e) => e.id === 'C').reason).toContain('unmet dependencies');
    expect(r.excluded.find((e) => e.id === 'D').reason).toContain(
      'overlaps wave member A',
    );
  });

  it('an in-wave dependency counts as satisfied (ordered composition)', () => {
    const r = composeWave([cand('A'), cand('B', { dependsOn: ['A'] })], CFG);
    expect(r.members.map((m) => m.id)).toEqual(['A', 'B']);
  });

  it('enforces the changed-line budget', () => {
    const r = composeWave(
      [cand('A', { changedLines: 80 }), cand('B', { changedLines: 40 })],
      CFG,
    );
    expect(r.members.map((m) => m.id)).toEqual(['A']);
    expect(r.excluded[0].reason).toContain('changed-line budget');
  });

  it('caps high-risk members — risk work rides small waves', () => {
    const r = composeWave(
      [
        cand('A', { write_scope: ['packages/events/a.ts'] }),
        cand('B', { write_scope: ['packages/events/b.ts'] }),
      ],
      CFG,
    );
    expect(r.members).toHaveLength(1);
    expect(r.excluded[0].reason).toContain('high-risk budget');
  });

  it('caps ticket count', () => {
    const r = composeWave([cand('A'), cand('B'), cand('C'), cand('D')], CFG);
    expect(r.members).toHaveLength(3);
    expect(r.excluded[0].reason).toContain('wave full');
  });
});

describe('scopesOverlap', () => {
  it('glob-vs-concrete and prefix containment both count', () => {
    expect(scopesOverlap(['src/a/**'], ['src/a/deep/f.ts'])).toBe(true);
    expect(scopesOverlap(['src/a/**'], ['src/b/**'])).toBe(false);
  });
});

describe('buildSyntheticBranch + waveInvalidation (P3-01, OPT-09)', () => {
  let repo, wtBase;
  const g = (args, opts = {}) =>
    execFileSync('git', args, {
      cwd: opts.cwd ?? repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'wave-repo-'));
    wtBase = mkdtempSync(join(tmpdir(), 'wave-wt-'));
    g(['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    g(['add', '.']);
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'],
      { cwd: repo },
    );
  });
  afterEach(() => {
    for (const d of [repo, wtBase]) rmSync(d, { recursive: true, force: true });
  });

  function makeBranch(name, file, content) {
    g(['checkout', '-q', '-b', name, 'main']);
    mkdirSync(join(repo, file.split('/')[0]), { recursive: true });
    writeFileSync(join(repo, file), content);
    g(['add', '.']);
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', name],
      { cwd: repo },
    );
    const sha = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    return sha;
  }

  it('merges disjoint members onto fresh base; a CONFLICTING member is excluded, never hand-resolved', () => {
    const shaA = makeBranch('sw/a', 'a/f.txt', 'A\n');
    const shaB = makeBranch('sw/b', 'b/f.txt', 'B\n');
    // conflicting member: edits base.txt differently than another member
    g(['checkout', '-q', '-b', 'sw/c1', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'C1\n');
    g(['add', '.']);
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c1'],
      { cwd: repo },
    );
    const shaC1 = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    g(['checkout', '-q', '-b', 'sw/c2', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'C2\n');
    g(['add', '.']);
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c2'],
      { cwd: repo },
    );
    const shaC2 = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);

    const r = buildSyntheticBranch({
      members: [
        { id: 'A', branch: 'sw/a', headSha: shaA },
        { id: 'C1', branch: 'sw/c1', headSha: shaC1 },
        { id: 'C2', branch: 'sw/c2', headSha: shaC2 }, // conflicts with C1
        { id: 'B', branch: 'sw/b', headSha: shaB },
      ],
      worktreeDir: wtBase,
      gitRun: (a, o) => g(a, o),
    });
    expect(r.merged.map((m) => m.id)).toEqual(['A', 'C1', 'B']);
    expect(r.conflicted[0].id).toBe('C2');
    expect(r.conflicted[0].reason).toContain('no feature work on the synthetic branch');
    // synthetic head really contains A + B + C1
    const tree = g(['ls-tree', '-r', '--name-only', r.headSha]).trim().split('\n');
    expect(tree).toContain('a/f.txt');
    expect(tree).toContain('b/f.txt');
  });

  it('invalidation hits ONLY the moved member; intact members stay tested assets', () => {
    const record = {
      merged: [
        { id: 'A', headSha: 'x1' },
        { id: 'B', headSha: 'y1' },
      ],
    };
    const r = waveInvalidation(record, { A: 'x1', B: 'y2' });
    expect(r.syntheticValid).toBe(false);
    expect(r.invalidMembers).toEqual([{ id: 'B', was: 'y1', now: 'y2' }]);
    expect(r.intactMembers).toEqual(['A']);
  });

  it('REFUSES a dirty synthetic tree — a lying substrate gates nothing', () => {
    const shaA = makeBranch('sw/da', 'da/f.txt', 'A\n');
    // gitRun wrapper that dirties the tree right after the merge succeeds
    const dirtyRun = (a, o) => {
      const out = g(a, o);
      if (a[0] === 'merge' && !a.includes('--abort'))
        writeFileSync(join(o.cwd, 'stray.txt'), 'dirt\n');
      return out;
    };
    expect(() =>
      buildSyntheticBranch({
        members: [{ id: 'A', branch: 'sw/da', headSha: shaA }],
        worktreeDir: wtBase,
        gitRun: dirtyRun,
      }),
    ).toThrow(/refusing to gate a lying substrate/);
  });
});
