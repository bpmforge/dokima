// wave-packet.test.mjs — P3-04: merge train + bounded human packet.
// RED provenance: the acceptance's own negatives — pre-merge drift halts the
// train BEFORE the merge; the Tier-D seam preamble refuses a train whose wave
// left open seam gaps; Done only on verified main ancestry.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeWavePacket } from './wave-packet.mjs';

describe('writeWavePacket on a real repo (P3-04, surviving half; train deleted in P6-13)', () => {
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
