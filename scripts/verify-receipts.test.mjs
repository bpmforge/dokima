// verify-receipts.test.mjs — P0-01 red/green suite for the untrusted verify
// receipt wrapper. RED provenance: every module under test is new in this
// ticket (pre-ticket runGates had NO receipt path at all — the forgery test
// below encodes the exact attack the pre-ticket code could not refuse), and
// the forged-receipt case is asserted directly rather than by narrative.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mintReceipt, receiptGaps, loadReceipt, receiptPath } from './conductor/receipts.mjs';

const NODE = process.execPath;
const ok = [NODE, ['-e', 'process.exit(0)']];
const fail = [NODE, ['-e', "console.error('two real TS2532s live here'); process.exit(1)"]];

function tempGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return { dir, sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() };
}

describe('mintReceipt', () => {
  let wt, sha, receiptsDir;
  beforeEach(() => {
    ({ dir: wt, sha } = tempGitRepo());
    receiptsDir = mkdtempSync(join(tmpdir(), 'receipts-out-'));
  });

  it('writes a receipt whose fields the agent never authors', () => {
    const { receipt, path } = mintReceipt({ ticketId: 'T-1', wt, headSha: sha, commands: [ok], receiptsDir });
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.ticketId).toBe('T-1');
    expect(onDisk.headSha).toBe(sha);
    expect(onDisk.commands).toHaveLength(1);
    const c = onDisk.commands[0];
    expect(c.exitCode).toBe(0);
    expect(c.command).toContain('-e');
    expect(typeof c.durationMs).toBe('number');
    expect(typeof c.startedAt).toBe('string');
    expect(receiptGaps(receipt, sha)).toEqual([]);
  });

  it('captures a nonzero exit with its output tail and fails fast', () => {
    const { receipt } = mintReceipt({ ticketId: 'T-1', wt, headSha: sha, commands: [fail, ok], receiptsDir });
    expect(receipt.commands).toHaveLength(1); // ok never ran — fail fast
    expect(receipt.commands[0].exitCode).toBe(1);
    expect(receipt.commands[0].tailOfOutput).toContain('two real TS2532s');
    const gaps = receiptGaps(receipt, sha);
    expect(gaps.some((g) => g.includes('exit 1') && g.includes('two real TS2532s'))).toBe(true);
  });

  it('OVERWRITES a hand-forged receipt claiming success — re-derive, never trust', () => {
    // The RDSAD-235 shape: a genuine-looking receipt claiming clean while the
    // command really fails. Pre-ticket code had no defense; the defense here
    // is that the gate always mints fresh and the forged file is never read.
    const p = receiptPath(receiptsDir, 'T-1', sha);
    execFileSync('mkdir', ['-p', receiptsDir]);
    writeFileSync(p, JSON.stringify({ ticketId: 'T-1', headSha: sha, commands: [{ command: 'pnpm test', exitCode: 0, tailOfOutput: 'all green' }] }));
    const { receipt } = mintReceipt({ ticketId: 'T-1', wt, headSha: sha, commands: [fail], receiptsDir });
    expect(receipt.commands[0].exitCode).toBe(1);
    const onDisk = JSON.parse(readFileSync(p, 'utf8'));
    expect(onDisk.commands[0].exitCode).toBe(1); // forgery replaced by reality
    expect(receiptGaps(onDisk, sha).length).toBeGreaterThan(0);
  });

  it('self-gitignores the receipts directory so evidence never dirties the repo (M-08)', () => {
    mintReceipt({ ticketId: 'T-1', wt, headSha: sha, commands: [ok], receiptsDir });
    expect(readFileSync(join(receiptsDir, '.gitignore'), 'utf8')).toContain('*');
  });
});

describe('receiptGaps', () => {
  const base = { ticketId: 'T-1', headSha: 'a'.repeat(40), commands: [{ command: 'x', exitCode: 0, tailOfOutput: '' }] };

  it('missing receipt is a gap, never a pass', () => {
    expect(receiptGaps(null, 'a'.repeat(40))[0]).toMatch(/missing/);
  });

  it('a receipt for the wrong commit is rejected (stale or forged)', () => {
    const gaps = receiptGaps(base, 'b'.repeat(40));
    expect(gaps.some((g) => g.includes('stale or forged'))).toBe(true);
  });

  it('any nonzero exit code gaps with the untruncated tail', () => {
    const long = 'E'.repeat(3000);
    const r = { ...base, commands: [{ command: 'pnpm test', exitCode: 2, tailOfOutput: long }] };
    const gaps = receiptGaps(r, base.headSha);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain(long); // no 400-char slice — the terminal cause survives
  });

  it('an empty command list cannot pass (bypassed wrapper)', () => {
    expect(receiptGaps({ ...base, commands: [] }, base.headSha).some((g) => g.includes('no commands'))).toBe(true);
  });

  it('loadReceipt returns null for absent or unparseable files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'receipts-load-'));
    expect(loadReceipt(dir, 'T-9', 'c'.repeat(40))).toBeNull();
    writeFileSync(receiptPath(dir, 'T-9', 'c'.repeat(40)), '{not json');
    expect(loadReceipt(dir, 'T-9', 'c'.repeat(40))).toBeNull();
  });
});
