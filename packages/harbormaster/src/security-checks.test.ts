/**
 * W23-04. Two classes of proof, kept apart on purpose (START_HERE rule 9).
 *
 * The FIXTURE tests below inject process results and prove the orchestration:
 * that a clean scan, findings, a timeout, a missing executable and malformed
 * output each land on a different status, and that none of them lands on
 * `passed`. They prove nothing about whether Semgrep works.
 *
 * The SMOKE test at the bottom runs a real bundled scanner against a real
 * planted credential, and is opt-in (`DOKIMA_TEST_REAL_SCANNERS=1`) so the
 * default suite never depends on an installed tool. That separation is the
 * point: a mocked adapter test is not evidence that a scanner detects
 * anything, and reporting it as such is exactly the confusion this card
 * exists to remove.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checksPermitAutomaticCompletion,
  runSecurityChecks,
  SECURITY_TOOLS,
  type CheckEvidence,
  type ProjectProfile,
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

const NODE_PROJECT: ProjectProfile = {
  hasNodeManifest: true,
  hasLockfile: true,
  hasInfrastructureAsCode: false,
};

const ok = (over: Partial<ToolRunResult> = {}): ToolRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  durationMs: 5,
  ...over,
});

function harness(
  responses: Record<string, ToolRunResult>,
  over: Partial<RunSecurityChecksOptions> = {},
): RunSecurityChecksOptions {
  return {
    cwd: '/tmp/project',
    sourceDigest: 'sha256:head',
    profile: NODE_PROJECT,
    networkPolicy: 'network-allowed',
    secretsValidatorPath: '/opt/dokima/secrets-scan.sh',
    runTool: async (adapter) => responses[adapter.checkId] ?? ok(),
    isInstalled: () => true,
    ...over,
  };
}

const byId = (checks: readonly CheckEvidence[], id: string): CheckEvidence =>
  checks.find((c) => c.checkId === id)!;

describe('the registry runs real tools and reads their own exit codes', () => {
  it('registers sast, secrets and dependency audit, each with a constant command', () => {
    expect(SECURITY_TOOLS.map((t) => t.checkId)).toEqual([
      'tool-sast',
      'tool-secrets',
      'tool-deps',
    ]);
    // The ids are internal tool nodes and must not collide with the model
    // specialist step ids (`security-sast` and friends) — a scanner result and
    // a specialist's interpretation of it are different evidence
    // (IMPLEMENTATION_PLAN §5).
    for (const tool of SECURITY_TOOLS) expect(tool.checkId).toMatch(/^tool-/);
  });

  it('a clean scan is PASSED, and carries the tool exit code beside the status', async () => {
    const checks = await runSecurityChecks(
      harness({
        'tool-sast': ok({ stdout: '{"results":[]}' }),
        'tool-secrets': ok(),
        'tool-deps': ok({
          stdout: '{"metadata":{"vulnerabilities":{"high":0,"info":3}}}',
        }),
      }),
    );
    expect(checks.map((c) => c.status)).toEqual(['passed', 'passed', 'passed']);
    expect(byId(checks, 'tool-sast').exitCode).toBe(0);
    expect(checksPermitAutomaticCompletion(checks).eligible).toBe(true);
  });

  it('findings are FINDINGS and are counted, not rounded to a pass or an error', async () => {
    const checks = await runSecurityChecks(
      harness({
        'tool-sast': ok({ exitCode: 1, stdout: '{"results":[{"a":1},{"b":2}]}' }),
        'tool-secrets': ok({
          exitCode: 1,
          stdout: ' - found something\n - and another\n',
        }),
        'tool-deps': ok({
          exitCode: 1,
          stdout: '{"metadata":{"vulnerabilities":{"critical":1,"low":2,"info":9}}}',
        }),
      }),
    );
    expect(byId(checks, 'tool-sast')).toMatchObject({
      status: 'findings',
      findingCount: 2,
    });
    expect(byId(checks, 'tool-secrets')).toMatchObject({
      status: 'findings',
      findingCount: 2,
    });
    // `info` is excluded: npm reports informational rows that are not findings.
    expect(byId(checks, 'tool-deps')).toMatchObject({
      status: 'findings',
      findingCount: 3,
    });
    const permit = checksPermitAutomaticCompletion(checks);
    expect(permit.eligible).toBe(false);
    expect(permit.blockedBy).toHaveLength(3);
  });

  it.each([
    ['a timeout', { 'tool-sast': ok({ timedOut: true, exitCode: null }) }, 'error'],
    [
      'a scanner that died before scanning',
      { 'tool-sast': ok({ exitCode: 2, stderr: 'invalid rule file' }) },
      'error',
    ],
    [
      'output that is not valid JSON — the dangerous case, since exit 0 reads as clean',
      { 'tool-sast': ok({ exitCode: 0, stdout: 'Traceback (most recent call last):' }) },
      'error',
    ],
  ])('%s is never PASSED', async (_name, responses, expected) => {
    const checks = await runSecurityChecks(
      harness(responses as Record<string, ToolRunResult>),
    );
    expect(byId(checks, 'tool-sast').status).toBe(expected);
    expect(checksPermitAutomaticCompletion(checks).eligible).toBe(false);
  });

  it('a missing executable is UNAVAILABLE and names itself — never NOT_APPLICABLE', async () => {
    const checks = await runSecurityChecks(
      harness({}, { isInstalled: (exe) => exe !== 'semgrep' }),
    );
    const sast = byId(checks, 'tool-sast');
    expect(sast.status).toBe('unavailable');
    expect(sast.reason).toMatch(/semgrep is not installed/);
    // The distinction the plan insists on: a missing Semgrep is not a project
    // that does not need SAST.
    expect(sast.status).not.toBe('not_applicable');
  });

  it('NOT_APPLICABLE carries a runtime-derived reason about the project, not about the host', async () => {
    const checks = await runSecurityChecks(
      harness({}, { profile: { ...NODE_PROJECT, hasLockfile: false } }),
    );
    const deps = byId(checks, 'tool-deps');
    expect(deps.status).toBe('not_applicable');
    expect(deps.reason).toMatch(/no lockfile/);
    // And it does not block completion, because nothing was skipped that could
    // have been looked at.
    expect(
      checksPermitAutomaticCompletion(checks.filter((c) => c.checkId === 'tool-deps'))
        .eligible,
    ).toBe(true);
  });
});

describe('local-only means local-only', () => {
  it('the dependency audit does not run, and its missing coverage is visible', async () => {
    let ranDeps = false;
    const checks = await runSecurityChecks(
      harness(
        {},
        {
          networkPolicy: 'local-only',
          localAdvisoryDbPath: null,
          runTool: async (adapter) => {
            if (adapter.checkId === 'tool-deps') ranDeps = true;
            return ok({ stdout: '{"results":[]}' });
          },
        },
      ),
    );
    expect(ranDeps).toBe(false);
    const deps = byId(checks, 'tool-deps');
    expect(deps.status).toBe('unavailable');
    expect(deps.reason).toMatch(/local-only/);
    expect(deps.reason).toMatch(/missing, not clean/);
    expect(checksPermitAutomaticCompletion(checks).eligible).toBe(false);
  });

  it('a network-allowed project runs it WITH the network, and a local-only one never gets that flag', async () => {
    const flags: boolean[] = [];
    await runSecurityChecks(
      harness(
        {},
        {
          networkPolicy: 'network-allowed',
          runTool: async (adapter, _args, opts) => {
            if (adapter.checkId === 'tool-deps') flags.push(opts.allowNetwork);
            return ok({ stdout: '{"metadata":{"vulnerabilities":{}}}' });
          },
        },
      ),
    );
    expect(flags).toEqual([true]);

    const localFlags: boolean[] = [];
    await runSecurityChecks(
      harness(
        {},
        {
          networkPolicy: 'local-only',
          localAdvisoryDbPath: '/opt/advisories.json',
          runTool: async (adapter, _args, opts) => {
            if (adapter.checkId === 'tool-deps') localFlags.push(opts.allowNetwork);
            return ok({ stdout: '{"metadata":{"vulnerabilities":{}}}' });
          },
        },
      ),
    );
    // It may run against the local snapshot; it may not open a socket.
    expect(localFlags).toEqual([false]);
  });

  it('an audit that reached no advisory database is UNAVAILABLE, not a clean bill of health', async () => {
    const checks = await runSecurityChecks(
      harness({
        'tool-deps': ok({ exitCode: 1, stdout: '{"error":{"code":"ENOTFOUND"}}' }),
      }),
    );
    expect(byId(checks, 'tool-deps').status).toBe('unavailable');
  });
});

describe('the command line is the adapter’s, and it is recorded', () => {
  it('substitutes only the runtime-owned placeholders and digests the result', async () => {
    const seen: string[][] = [];
    const checks = await runSecurityChecks(
      harness(
        {},
        {
          cwd: '/tmp/some/worktree',
          secretsValidatorPath: '/opt/dokima/secrets-scan.sh',
          runTool: async (_adapter, args) => {
            seen.push([...args]);
            return ok({ stdout: '{"results":[]}' });
          },
        },
      ),
    );
    expect(seen[1]).toEqual(['/opt/dokima/secrets-scan.sh', '/tmp/some/worktree']);
    // Nothing else was templated: a placeholder nobody defined stays literal
    // rather than becoming an empty string in a command line.
    expect(seen[0]).toEqual([
      '--config',
      'auto',
      '--json',
      '--quiet',
      '--metrics=off',
      '--error',
      '.',
    ]);
    expect(byId(checks, 'tool-sast').inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('the same check with different arguments has a different input digest', async () => {
    const a = await runSecurityChecks(harness({}, { cwd: '/a' }));
    const b = await runSecurityChecks(harness({}, { cwd: '/b' }));
    expect(byId(a, 'tool-secrets').inputDigest).not.toBe(
      byId(b, 'tool-secrets').inputDigest,
    );
  });
});

/**
 * OPT-IN SMOKE PATH. Runs the real bundled scanner against a real planted
 * credential — the only test here that proves a tool detects anything. Off by
 * default so the suite never depends on an installed tool, and never
 * auto-installs one.
 */
const smoke = process.env.DOKIMA_TEST_REAL_SCANNERS === '1' ? describe : describe.skip;

smoke('opt-in: the bundled secrets scanner actually detects a planted credential', () => {
  it('finds it, and exits 1 rather than 0', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-smoke-secrets-'));
    dirs.push(dir);
    // Assembled, not written as a literal: this repo's own pre-commit scan
    // reads the staged diff and cannot tell a fixture from a leak.
    const planted = ['AKIA', 'A'.repeat(16)].join('');
    await fs.writeFile(path.join(dir, 'config.js'), `const awsKey = '${planted}';\n`);

    const here = path.dirname(fileURLToPath(import.meta.url));
    const scanner = path.resolve(here, '../../../content/validators/secrets-scan.sh');

    let exitCode = 0;
    let stdout = '';
    try {
      const result = await execFileAsync('bash', [scanner, dir]);
      stdout = result.stdout;
    } catch (err) {
      const e = err as { code?: number; stdout?: string };
      exitCode = e.code ?? -1;
      stdout = e.stdout ?? '';
    }

    expect(exitCode).toBe(1);
    expect(stdout.toLowerCase()).toMatch(/aws|key/);
  });
});
