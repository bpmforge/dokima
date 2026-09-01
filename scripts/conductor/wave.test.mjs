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
  stackParkedDeps,
} from './wave.mjs';
import { claimableTickets } from '../conductor-lib.mjs';

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

describe('P6-06 — board-metadata carve-out + parked-dependency stacking', () => {
  let repo, wtBase;
  const BOARD = 'docs/board.json';
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
      {
        cwd,
      },
    );

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'p606-repo-'));
    wtBase = mkdtempSync(join(tmpdir(), 'p606-wt-'));
    g(['init', '-q', '-b', 'main']);
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    writeFileSync(join(repo, BOARD), '{"tickets":"ROOT TRUTH"}\n');
    g(['add', '.']);
    commit('base');
  });
  afterEach(() => {
    for (const d of [repo, wtBase]) rmSync(d, { recursive: true, force: true });
  });

  // A member branch: its own code file + a REWRITTEN board (every ticket
  // branch edits the board; two rewrites are a guaranteed conflict).
  function member(name, codeFile, boardText) {
    g(['checkout', '-q', '-b', name, 'main']);
    mkdirSync(join(repo, codeFile.split('/')[0]), { recursive: true });
    writeFileSync(join(repo, codeFile), `${name}\n`);
    writeFileSync(join(repo, BOARD), boardText);
    g(['add', '.']);
    commit(name);
    const sha = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    return sha;
  }

  it('two members whose ONLY conflict is the board file BOTH land, and the base board wins', () => {
    const shaA = makeMemberPair();
    const r = buildSyntheticBranch({
      members: shaA,
      worktreeDir: wtBase,
      gitRun: g,
      metadataPaths: [BOARD],
    });
    expect(r.conflicted).toEqual([]);
    expect(r.merged.map((m) => m.id)).toEqual(['M1', 'M2']);
    // deterministic resolution: the BASE (ROOT) board survives, not either rewrite
    const board = g(['show', 'HEAD:' + BOARD], { cwd: r.wt });
    expect(board).toContain('ROOT TRUTH');
    // and both members' code is present
    g(['show', 'HEAD:a/f.txt'], { cwd: r.wt });
    g(['show', 'HEAD:b/f.txt'], { cwd: r.wt });
  });

  it('RED provenance: WITHOUT the carve-out the identical pair refuses the second member', () => {
    const members = makeMemberPair();
    const r = buildSyntheticBranch({ members, worktreeDir: wtBase, gitRun: g });
    expect(r.conflicted.map((c) => c.id)).toEqual(['M2']);
  });

  function makeMemberPair() {
    return [
      {
        id: 'M1',
        branch: 'sw/m1',
        headSha: member('sw/m1', 'a/f.txt', '{"tickets":"M1 DONE"}\n'),
      },
      {
        id: 'M2',
        branch: 'sw/m2',
        headSha: member('sw/m2', 'b/f.txt', '{"tickets":"M2 DONE"}\n'),
      },
    ];
  }

  it('a CODE conflict still excludes the member — the carve-out never touches feature work', () => {
    g(['checkout', '-q', '-b', 'sw/c1', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'C1\n');
    writeFileSync(join(repo, BOARD), '{"tickets":"C1"}\n');
    g(['add', '.']);
    commit('c1');
    const sha1 = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    g(['checkout', '-q', '-b', 'sw/c2', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'C2\n');
    writeFileSync(join(repo, BOARD), '{"tickets":"C2"}\n');
    g(['add', '.']);
    commit('c2');
    const sha2 = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    const r = buildSyntheticBranch({
      members: [
        { id: 'C1', branch: 'sw/c1', headSha: sha1 },
        { id: 'C2', branch: 'sw/c2', headSha: sha2 },
      ],
      worktreeDir: wtBase,
      gitRun: g,
      metadataPaths: [BOARD],
    });
    expect(r.merged.map((m) => m.id)).toEqual(['C1']);
    expect(r.conflicted.map((c) => c.id)).toEqual(['C2']);
    expect(r.conflicted[0].reason).toContain('base.txt');
  });

  it('stackParkedDeps merges a parked dependency (board carve-out included) and returns the post-stack head as scopeBase', () => {
    member('sw/w1-01', 'dep/f.txt', '{"tickets":"DEP DONE"}\n');
    // ROOT board moved after the dep forked (the park write) — guaranteed board conflict
    writeFileSync(join(repo, BOARD), '{"tickets":"W1-01 PARKED"}\n');
    g(['add', BOARD]);
    commit('park W1-01');
    const wt = join(wtBase, 'claim');
    g(['worktree', 'add', '-q', '-b', 'sw/w1-02', wt, 'main']);
    const res = stackParkedDeps({
      ticket: { id: 'W1-02', depends_on: ['W1-01'] },
      plan: { tickets: [{ id: 'W1-01', status: 'parked' }] },
      wt,
      branchPrefix: 'sw/',
      gitRun: g,
      boardPath: BOARD,
    });
    expect(res.failed).toBeNull();
    expect(res.stacked).toEqual(['W1-01']);
    expect(res.scopeBase).toBe(g(['rev-parse', 'HEAD'], { cwd: wt }).trim());
    g(['show', 'HEAD:dep/f.txt'], { cwd: wt }); // the dep's code is present
    expect(g(['show', 'HEAD:' + BOARD], { cwd: wt })).toContain('PARKED'); // ROOT truth kept
    // and the scope diff from scopeBase is EMPTY — the dep's files can never
    // read as the claimant's out-of-scope edits
    expect(g(['diff', '--name-only', `${res.scopeBase}...sw/w1-02`]).trim()).toBe('');
  });

  it('a stack CODE conflict fails the claim with the evidence — never auto-resolved', () => {
    member('sw/w1-01', 'dep/f.txt', '{"tickets":"DEP"}\n');
    // dep also touched base.txt; main then moved base.txt differently
    g(['checkout', '-q', 'sw/w1-01']);
    writeFileSync(join(repo, 'base.txt'), 'DEP EDIT\n');
    g(['add', '.']);
    commit('dep edits base');
    g(['checkout', '-q', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'MAIN MOVED\n');
    g(['add', '.']);
    commit('main moved');
    const wt = join(wtBase, 'claim2');
    g(['worktree', 'add', '-q', '-b', 'sw/w1-02', wt, 'main']);
    const res = stackParkedDeps({
      ticket: { id: 'W1-02', depends_on: ['W1-01'] },
      plan: { tickets: [{ id: 'W1-01', status: 'parked' }] },
      wt,
      branchPrefix: 'sw/',
      gitRun: g,
      boardPath: BOARD,
    });
    expect(res.failed).toContain('W1-01');
    expect(res.failed).toContain('base.txt');
  });
});

describe('claimableTickets parked semantics (P6-06 + Challenger F2)', () => {
  const row = (id, over = {}) => ({
    id,
    lane: 'x',
    status: 'todo',
    depends_on: [],
    write_scope: ['a/**'],
    ...over,
  });

  it("'parked' is never claimable — a restart cannot re-claim and branch-D parked work", () => {
    const plan = { tickets: [row('W1-01', { status: 'parked' })] };
    expect(claimableTickets(plan)).toEqual([]);
  });

  it('parked satisfies a dependency ONLY under parkedSatisfiesDeps (per-feature landing)', () => {
    const plan = {
      tickets: [
        row('W1-01', { status: 'parked' }),
        row('W1-02', { depends_on: ['W1-01'], lane: 'y' }),
      ],
    };
    expect(claimableTickets(plan).map((t) => t.id)).toEqual([]);
    expect(
      claimableTickets(plan, { parkedSatisfiesDeps: true }).map((t) => t.id),
    ).toEqual(['W1-02']);
  });
});
