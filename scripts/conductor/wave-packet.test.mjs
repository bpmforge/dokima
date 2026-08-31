// wave-packet.test.mjs — P3-04: merge train + bounded human packet.
// RED provenance: the acceptance's own negatives — pre-merge drift halts the
// train BEFORE the merge; the Tier-D seam preamble refuses a train whose wave
// left open seam gaps; Done only on verified main ancestry.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  trainPreamble,
  runMergeTrain,
  writeWavePacket,
  verifyMainAncestry,
} from './wave-packet.mjs';

describe('trainPreamble — Tier-D seam gate wired (P3-04/P3-02)', () => {
  it('refuses to start while a seam gap is open; clean gaps proceed', () => {
    expect(trainPreamble({ seamGaps: [] }).ok).toBe(true);
    const r = trainPreamble({ seamGaps: ['Tier-D seam gap [@x#y] ...'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('seam gate open');
  });
});

describe('merge train on a real repo (P3-04)', () => {
  let repo;
  const g = (args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commit = (msg) =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg],
      { cwd: repo },
    );

  const makeBranch = (name, file) => {
    g(['checkout', '-q', '-b', name, 'main']);
    mkdirSync(join(repo, file.split('/')[0]), { recursive: true });
    writeFileSync(join(repo, file), `${name}\n`);
    g(['add', '.']);
    commit(name);
    const sha = g(['rev-parse', 'HEAD']).trim();
    g(['checkout', '-q', 'main']);
    return sha;
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'train-'));
    g(['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    g(['add', '.']);
    commit('base');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('merges members in order and records post-merge shas; Done only via verified main ancestry', () => {
    const shaA = makeBranch('sw/a', 'a/f.txt');
    const shaB = makeBranch('sw/b', 'b/f.txt');
    const record = {
      baseSha: g(['rev-parse', 'main']).trim(),
      headSha: 'f'.repeat(40),
      merged: [
        { id: 'A', headSha: shaA, branchRef: 'sw/a' },
        { id: 'B', headSha: shaB, branchRef: 'sw/b' },
      ],
    };
    const r = runMergeTrain({ record, order: ['A', 'B'], gitRun: (a) => g(a) });
    expect(r.complete).toBe(true);
    expect(r.merged.map((m) => m.id)).toEqual(['A', 'B']);
    const anc = verifyMainAncestry({
      memberIds: ['A', 'B'],
      gitRun: (a) => g(a),
      boardStatus: () => 'todo',
    });
    expect(anc.every((x) => x.onMain && x.mayTransition)).toBe(true);
  });

  it('HALTS BEFORE the merge when a member moved after the wave passed — downstream never skipped ahead', () => {
    const shaA = makeBranch('sw/a', 'a/f.txt');
    const shaB = makeBranch('sw/b', 'b/f.txt');
    // B moves after the wave: amend a new commit on sw/b
    g(['checkout', '-q', 'sw/b']);
    writeFileSync(join(repo, 'b/extra.txt'), 'late change\n');
    g(['add', '.']);
    commit('late');
    g(['checkout', '-q', 'main']);
    const record = {
      baseSha: g(['rev-parse', 'main']).trim(),
      headSha: 'f'.repeat(40),
      merged: [
        { id: 'B', headSha: shaB, branchRef: 'sw/b' },
        { id: 'A', headSha: shaA, branchRef: 'sw/a' },
      ],
    };
    const r = runMergeTrain({ record, order: ['B', 'A'], gitRun: (a) => g(a) });
    expect(r.complete).toBe(false);
    expect(r.merged).toHaveLength(0); // halted BEFORE merging the moved member
    expect(r.halted[0].id).toBe('B');
    expect(r.halted[0].reason).toContain('moved after the wave passed');
    // main untouched
    expect(g(['log', '--oneline', 'main']).trim().split('\n')).toHaveLength(1);
  });

  it('halts when main advanced under the train', () => {
    const shaA = makeBranch('sw/a', 'a/f.txt');
    const record = {
      baseSha: g(['rev-parse', 'main']).trim(),
      headSha: 'f'.repeat(40),
      merged: [{ id: 'A', headSha: shaA, branchRef: 'sw/a' }],
    };
    // someone lands directly on main after the wave was built
    writeFileSync(join(repo, 'hotfix.txt'), 'x\n');
    g(['add', '.']);
    commit('hotfix');
    const r = runMergeTrain({ record, order: ['A'], gitRun: (a) => g(a) });
    expect(r.complete).toBe(false);
    expect(r.halted[0].reason).toContain('main advanced under the train');
  });

  it('a seam gap refuses the whole train via the preamble', () => {
    const r = runMergeTrain({
      record: { baseSha: 'x', headSha: 'y', merged: [] },
      order: [],
      gitRun: () => '',
      seamGaps: ['Tier-D seam gap [@dokima/tickets#mintReceipt] (consumer W1-02): ...'],
    });
    expect(r.complete).toBe(false);
    expect(r.halted[0].reason).toContain('seam gate open');
  });

  it('writeWavePacket produces the bounded 2-4h packet: members, tiers, diff stat, log slice — never "read the repo"', () => {
    const shaA = makeBranch('sw/a', 'a/f.txt');
    const out = mkdtempSync(join(tmpdir(), 'packet-'));
    try {
      const record = {
        branch: 'wave/synth-test',
        baseSha: g(['rev-parse', 'main']).trim(),
        headSha: shaA,
        merged: [{ id: 'A', headSha: shaA }],
        conflicted: [{ id: 'X', reason: 'merge conflict — excluded' }],
      };
      const tiers = {
        actOn: [
          {
            severity: 'HIGH',
            file: 'a/f.txt',
            issue: 'thing',
            reviewers: ['code', 'security'],
            attributedTo: 'A',
            id: 'F-A-1',
          },
        ],
        consider: [],
        noted: [],
        dismissed: [{ file: 'ghost.ts', issue: 'made up' }],
      };
      const path = writeWavePacket({
        record,
        tiers,
        logRows: [{ ts: 't1', kind: 'ticket.done', ticket: 'A', msg: 'landed' }],
        outDir: out,
        gitRun: (a) => g(a),
      });
      const md = readFileSync(path, 'utf8');
      expect(md).toContain('machine-stop line');
      expect(md).toContain('- A @');
      expect(md).toContain('[HIGH] a/f.txt');
      expect(md).toContain('dismissed (1');
      expect(md).toContain('Wave log slice');
      expect(md).toContain('2-4h');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
