/**
 * W23-51 — findings already present at the ticket's base are not the ticket's.
 *
 * RED fixture: the live 2026-09-23 review counted 14 `npm audit` advisories
 * against a ticket that touched no dependency. The load-bearing half is the
 * NEGATIVE one: a ticket that introduces a finding must still come back
 * FINDINGS, or the baseline launders real defects (Law 4).
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveCheckout,
  depsFindingKeys,
  introducedFindings,
  removeBaselineCheckout,
  sastFindingKeys,
} from './security-baseline.js';
import {
  checksPermitAutomaticCompletion,
  runSecurityChecks,
  type CheckEvidence,
  type RunSecurityChecksOptions,
  type ToolRunResult,
} from './security-checks.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const run = (over: Partial<ToolRunResult> = {}): ToolRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  durationMs: 1,
  ...over,
});

/** An `npm audit --json` report with `n` distinct vulnerable packages. */
function audit(names: readonly string[]): string {
  const vulnerabilities = Object.fromEntries(
    names.map((n) => [n, { severity: 'high', range: '<1.0.0' }]),
  );
  return JSON.stringify({
    vulnerabilities,
    metadata: { vulnerabilities: { high: names.length, info: 0 } },
  });
}

function sastReport(
  findings: readonly { rule: string; file: string; line: number; text: string }[],
): string {
  return JSON.stringify({
    results: findings.map((f) => ({
      check_id: `Users.me.rulepacks.packs.owasp.${f.rule}`,
      path: f.file,
      start: { line: f.line },
      extra: { lines: f.text },
    })),
  });
}

const FOURTEEN = Array.from({ length: 14 }, (_, i) => `pkg-${i}`);

function withBaseline(
  head: Record<string, ToolRunResult>,
  base: Record<string, ToolRunResult> | null,
  over: Partial<RunSecurityChecksOptions> = {},
): RunSecurityChecksOptions {
  return {
    cwd: '/work/head',
    sourceDigest: 'sha256:head',
    profile: { hasNodeManifest: true, hasLockfile: true, hasInfrastructureAsCode: false },
    networkPolicy: 'network-allowed',
    secretsValidatorPath: '/opt/secrets-scan.sh',
    sastRules: {
      root: '/r',
      configPaths: ['/r/owasp'],
      digest: 'sha256:r',
      ruleFileCount: 1,
    },
    baseline: {
      ref: '0ac6e267f6d1e22674b14dbc1090dbc3f6895cdb',
      checkout: async () => (base ? '/work/base' : null),
    },
    runTool: async (adapter, _args, opts) => {
      const table = opts.cwd === '/work/base' ? (base ?? {}) : head;
      return table[adapter.checkId] ?? run({ stdout: '{"results":[]}' });
    },
    isInstalled: () => true,
    ...over,
  };
}

const byId = (checks: readonly CheckEvidence[], id: string) =>
  checks.find((c) => c.checkId === id)!;

describe('introducedFindings is a multiset difference', () => {
  it('two identical findings at head against one at base is ONE introduced', () => {
    expect(introducedFindings(['a', 'a', 'b'], ['a'])).toEqual({
      introduced: ['a', 'b'],
      preexisting: 1,
    });
  });
  it('everything at base is pre-existing; base-only findings are not counted', () => {
    expect(introducedFindings(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      introduced: [],
      preexisting: 2,
    });
  });
});

describe('finding identities', () => {
  it('a SAST finding is rule + file + matched text: a moved line is the same finding, a new rule match is not', () => {
    const base = sastFindingKeys(
      sastReport([{ rule: 'r1', file: 'a.ts', line: 3, text: 'eval(x)' }]),
    )!;
    const moved = sastFindingKeys(
      sastReport([{ rule: 'r1', file: 'a.ts', line: 30, text: '  eval(x)' }]),
    )!;
    expect(moved).toEqual(base);
    expect(base[0]).toBe('r1|a.ts|eval(x)');
    expect(sastFindingKeys('not json')).toBeNull();
  });
  it('a dependency finding is package + severity + range; info rows are not findings', () => {
    const keys = depsFindingKeys(
      JSON.stringify({
        vulnerabilities: {
          lodash: { severity: 'high', range: '<4.17.21' },
          x: { severity: 'info', range: '*' },
        },
      }),
    );
    expect(keys).toEqual(['lodash|high|<4.17.21']);
  });
});

describe('W23-51: the review judges the change, not the project', () => {
  it('RED: 14 dependency findings that were already there at base do not count against the ticket', async () => {
    const checks = await runSecurityChecks(
      withBaseline(
        { 'tool-deps': run({ exitCode: 1, stdout: audit(FOURTEEN) }) },
        { 'tool-deps': run({ exitCode: 1, stdout: audit(FOURTEEN) }) },
      ),
    );
    const deps = byId(checks, 'tool-deps');
    expect(deps.status).toBe('passed');
    expect(deps.findingCount).toBe(0);
    // Not hidden: the pass says how many pre-existing findings it rests on.
    expect(deps.preexistingCount).toBe(14);
    expect(deps.baselineRef).toBe('0ac6e267f6d1e22674b14dbc1090dbc3f6895cdb');
    expect(deps.reason).toMatch(/14 finding\(s\) already present at base 0ac6e267f6d1/);
    expect(checksPermitAutomaticCompletion(checks).eligible).toBe(true);
  });

  it('NEGATIVE: a ticket that ADDS a vulnerable dependency is still FINDINGS, counting only its own', async () => {
    const checks = await runSecurityChecks(
      withBaseline(
        { 'tool-deps': run({ exitCode: 1, stdout: audit([...FOURTEEN, 'evil-pkg']) }) },
        { 'tool-deps': run({ exitCode: 1, stdout: audit(FOURTEEN) }) },
      ),
    );
    const deps = byId(checks, 'tool-deps');
    expect(deps.status).toBe('findings');
    expect(deps.findingCount).toBe(1);
    expect(deps.preexistingCount).toBe(14);
    expect(checksPermitAutomaticCompletion(checks).eligible).toBe(false);
  });

  it('NEGATIVE: a SAST finding the ticket introduces is FINDINGS, even beside a pre-existing one', async () => {
    const old = { rule: 'cmd-injection', file: 'src/a.ts', line: 3, text: 'exec(cmd)' };
    const fresh = {
      rule: 'cmd-injection',
      file: 'src/b.ts',
      line: 9,
      text: 'exec(input)',
    };
    const checks = await runSecurityChecks(
      withBaseline(
        { 'tool-sast': run({ exitCode: 1, stdout: sastReport([old, fresh]) }) },
        { 'tool-sast': run({ exitCode: 1, stdout: sastReport([old]) }) },
      ),
    );
    expect(byId(checks, 'tool-sast')).toMatchObject({
      status: 'findings',
      findingCount: 1,
      preexistingCount: 1,
    });
  });

  it('NEGATIVE: a duplicated vulnerable line is introduced, not pre-existing', async () => {
    const line = { rule: 'cmd-injection', file: 'src/a.ts', line: 3, text: 'exec(cmd)' };
    const checks = await runSecurityChecks(
      withBaseline(
        { 'tool-sast': run({ exitCode: 1, stdout: sastReport([line, line]) }) },
        { 'tool-sast': run({ exitCode: 1, stdout: sastReport([line]) }) },
      ),
    );
    expect(byId(checks, 'tool-sast')).toMatchObject({
      status: 'findings',
      findingCount: 1,
    });
  });

  it('SAST findings that all exist at base pass, with the count said', async () => {
    const old = { rule: 'weak-hash', file: 'src/a.ts', line: 3, text: 'md5(x)' };
    const checks = await runSecurityChecks(
      withBaseline(
        { 'tool-sast': run({ exitCode: 1, stdout: sastReport([{ ...old, line: 40 }]) }) },
        { 'tool-sast': run({ exitCode: 1, stdout: sastReport([old]) }) },
      ),
    );
    expect(byId(checks, 'tool-sast')).toMatchObject({
      status: 'passed',
      preexistingCount: 1,
    });
  });

  it('fails closed: a base that cannot be checked out leaves the head findings standing', async () => {
    const checks = await runSecurityChecks(
      withBaseline({ 'tool-deps': run({ exitCode: 1, stdout: audit(FOURTEEN) }) }, null),
    );
    const deps = byId(checks, 'tool-deps');
    expect(deps.status).toBe('findings');
    expect(deps.findingCount).toBe(14);
    expect(deps.reason).toMatch(/not compared with base/);
  });

  it('fails closed: a base scan that errored leaves the head findings standing', async () => {
    const checks = await runSecurityChecks(
      withBaseline(
        {
          'tool-sast': run({
            exitCode: 1,
            stdout: sastReport([{ rule: 'r', file: 'a', line: 1, text: 't' }]),
          }),
        },
        { 'tool-sast': run({ exitCode: 2, stderr: 'boom' }) },
      ),
    );
    expect(byId(checks, 'tool-sast')).toMatchObject({
      status: 'findings',
      findingCount: 1,
    });
    expect(byId(checks, 'tool-sast').reason).toMatch(/base scan was error/);
  });

  it('no baseline at all behaves exactly as before: findings are counted whole', async () => {
    const checks = await runSecurityChecks(
      withBaseline({ 'tool-deps': run({ exitCode: 1, stdout: audit(FOURTEEN) }) }, null, {
        baseline: null,
      }),
    );
    expect(byId(checks, 'tool-deps')).toMatchObject({
      status: 'findings',
      findingCount: 14,
    });
  });
});

describe('archiveCheckout', () => {
  it('extracts the base tree to a temp dir without adding a worktree, and refuses an unknown ref', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-baseline-test-'));
    dirs.push(repo);
    const git = (...args: string[]) =>
      execFileAsync('git', [
        '-C',
        repo,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        ...args,
      ]);
    await git('init', '-q');
    await fs.writeFile(path.join(repo, 'package-lock.json'), '{"v":1}\n');
    await git('add', '.');
    await git('commit', '-qm', 'base');
    const { stdout } = await git('rev-parse', 'HEAD');
    await fs.writeFile(path.join(repo, 'package-lock.json'), '{"v":2}\n');
    await git('commit', '-qam', 'head');

    const dir = await archiveCheckout(repo, stdout.trim());
    expect(dir).not.toBeNull();
    expect(await fs.readFile(path.join(dir!, 'package-lock.json'), 'utf8')).toBe(
      '{"v":1}\n',
    );
    const { stdout: worktrees } = await git('worktree', 'list');
    expect(worktrees.trim().split('\n')).toHaveLength(1);
    await removeBaselineCheckout(dir!);
    await expect(fs.access(dir!)).rejects.toThrow();

    expect(await archiveCheckout(repo, 'no-such-ref')).toBeNull();
  });
});
