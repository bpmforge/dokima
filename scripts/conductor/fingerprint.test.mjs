// fingerprint.test.mjs — P2-02 table-driven suite for failure fingerprints
// and the Stage-2 differential. RED provenance: pre-ticket the conductor had
// no representation for "candidate valid, base red" — the founding incident's
// exact gap; classifyDifferential's four rows ARE the incident review's table.

import { describe, it, expect } from 'vitest';
import {
  normalizeLine,
  parseFailures,
  fingerprint,
  receiptFingerprints,
  classifyDifferential,
} from './fingerprint.mjs';

const row = (suite, test, errorClass = 'test-failure') => {
  const r = { suite, test, file: null, line: null, errorClass };
  return { ...r, fp: fingerprint(r) };
};

describe('normalizeLine (P2-02)', () => {
  it('strips every volatile class so twins from two worktrees match', () => {
    const a = normalizeLine(
      'FAIL 2026-08-31T18:00:00.123Z /tmp/wt-abc123/src/x.test.ts took 431ms on localhost:4317 id deadbeefdeadbeef',
    );
    const b = normalizeLine(
      'FAIL 2026-09-01T02:11:09.999Z /tmp/wt-zzz999/src/x.test.ts took 12ms on localhost:9999 id cafebabecafebabe',
    );
    expect(a).toBe(b);
    expect(a).toContain('<ts>');
    expect(a).toContain('<tmp>');
    expect(a).toContain('<host:port>');
  });
});

describe('parseFailures (P2-02)', () => {
  it('parses vitest FAIL lines into suite/test rows', () => {
    const rows = parseFailures(
      'pnpm test',
      'FAIL src/a.test.ts > suite > does the thing\n× another test',
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].suite).toBe('src/a.test.ts');
    expect(rows[0].test).toContain('does the thing');
  });

  it('parses assertion classes', () => {
    const rows = parseFailures('pnpm test', 'AssertionError: expected true to be false');
    expect(rows.some((r) => r.errorClass === 'AssertionError')).toBe(true);
  });

  it('NEVER drops an unparseable failure — degrades to one command-level row', () => {
    const rows = parseFailures('pnpm lint', 'some completely unknown tool output');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ suite: 'pnpm lint', errorClass: 'nonzero-exit' });
  });
});

describe('receiptFingerprints (P2-02)', () => {
  it('fingerprints only failed commands', () => {
    const receipt = {
      commands: [
        { command: 'pnpm lint', exitCode: 0, tailOfOutput: 'clean' },
        { command: 'pnpm test', exitCode: 1, tailOfOutput: 'FAIL src/a.test.ts > s > t' },
      ],
    };
    const rows = receiptFingerprints(receipt);
    expect(rows).toHaveLength(1);
    expect(rows[0].fp).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('classifyDifferential — the incident review table as code (P2-02)', () => {
  const A = row('s1', 'old failure');
  const B = row('s2', 'new failure');

  it('base green + candidate red = candidate_regression (charges an attempt)', () => {
    const d = classifyDifferential([], [B]);
    expect(d.classification).toBe('candidate_regression');
    expect(d.chargeAttempt).toBe(true);
  });

  it('identical red fingerprints = blocked_on_baseline (charges NOTHING)', () => {
    const d = classifyDifferential([A], [A]);
    expect(d.classification).toBe('blocked_on_baseline');
    expect(d.chargeAttempt).toBe(false);
    expect(d.newRows).toHaveLength(0);
  });

  it('mixed charges ONLY the new rows', () => {
    const d = classifyDifferential([A], [A, B]);
    expect(d.classification).toBe('mixed');
    expect(d.chargeAttempt).toBe(true);
    expect(d.newRows.map((r) => r.fp)).toEqual([B.fp]);
    expect(d.sharedRows.map((r) => r.fp)).toEqual([A.fp]);
  });

  it('base red + candidate green = candidate_repairs_baseline (explicit, never silent)', () => {
    const d = classifyDifferential([A], []);
    expect(d.classification).toBe('candidate_repairs_baseline');
    expect(d.chargeAttempt).toBe(false);
  });

  it('both green = green', () => {
    expect(classifyDifferential([], []).classification).toBe('green');
  });

  it('volatile noise cannot split a fingerprint pair (the degrade-to-all-new hazard)', () => {
    const base = parseFailures(
      'pnpm test',
      'FAIL src/x.test.ts > s > t took 431ms at 2026-08-31T01:00:00Z',
    ).map((r) => ({ ...r, fp: fingerprint(r) }));
    const cand = parseFailures(
      'pnpm test',
      'FAIL src/x.test.ts > s > t took 12ms at 2026-09-01T09:30:00Z',
    ).map((r) => ({ ...r, fp: fingerprint(r) }));
    expect(classifyDifferential(base, cand).classification).toBe('blocked_on_baseline');
  });
});
