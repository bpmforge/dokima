/**
 * W23-51 — tool-sast runs Opengrep over the founder's pinned rule packs.
 *
 * The RED fixture is the live failure itself: semgrep 1.175.0 answers
 * `--config auto` + `--metrics=off` with exit 2 and "Cannot create auto config
 * when metrics are off", so every machine review carried an errored SAST
 * check. The fake runner below answers exactly that for that argument pair,
 * and a clean JSON scan for anything else — so the check reaching a real
 * verdict is a fact about the command the adapter builds, not about the fake.
 */

import { describe, expect, it } from 'vitest';
import {
  runSecurityChecks,
  SECURITY_TOOLS,
  type CheckEvidence,
  type RunSecurityChecksOptions,
  type ToolRunResult,
} from './security-checks.js';
import type { SastRuleset } from './sast-rules.js';

const SEMGREP_REFUSAL =
  '[00.10][ERROR]: Cannot create auto config when metrics are off. Please allow metrics or run with a specific config.\n';

const RULES: SastRuleset = {
  root: '/home/me/rulepacks/packs',
  configPaths: ['/home/me/rulepacks/packs/owasp', '/home/me/rulepacks/packs/secrets'],
  digest: 'sha256:pinned',
  ruleFileCount: 12,
};

const run = (over: Partial<ToolRunResult> = {}): ToolRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  durationMs: 1,
  ...over,
});

/** Behaves like the scanners on this host did on 2026-09-23. */
function hostLikeRunner(seen: string[][]): RunSecurityChecksOptions['runTool'] {
  return async (adapter, args) => {
    seen.push([adapter.executable, ...args]);
    if (adapter.checkId !== 'tool-sast') return run();
    if (args.includes('auto') && args.includes('--metrics=off')) {
      return run({ exitCode: 2, stderr: SEMGREP_REFUSAL });
    }
    return run({ stdout: '{"results":[],"errors":[]}' });
  };
}

function options(over: Partial<RunSecurityChecksOptions> = {}): RunSecurityChecksOptions {
  return {
    cwd: '/work/tree',
    sourceDigest: 'sha256:head',
    profile: {
      hasNodeManifest: false,
      hasLockfile: false,
      hasInfrastructureAsCode: false,
    },
    networkPolicy: 'local-only',
    secretsValidatorPath: '/opt/secrets-scan.sh',
    sastRules: RULES,
    runTool: hostLikeRunner([]),
    isInstalled: () => true,
    ...over,
  };
}

const sast = (checks: readonly CheckEvidence[]) =>
  checks.find((c) => c.checkId === 'tool-sast')!;

describe('W23-51: tool-sast is Opengrep over pinned local rules', () => {
  it('RED: the command semgrep refuses today is no longer what runs — the check reaches a real verdict', async () => {
    const seen: string[][] = [];
    const checks = await runSecurityChecks(options({ runTool: hostLikeRunner(seen) }));
    const result = sast(checks);
    expect(result.status).toBe('passed');
    expect(result.reason ?? '').not.toMatch(/Cannot create auto config/);
    const command = seen.find((c) => c.includes('scan'))!;
    expect(command[0]).toBe('opengrep');
    expect(command).not.toContain('auto');
    expect(command.some((a) => a.startsWith('--metrics'))).toBe(false);
    expect(command).toContain('--disable-version-check');
  });

  it('never names a registry ruleset: every --config is a pinned local path', () => {
    const adapter = SECURITY_TOOLS.find((t) => t.checkId === 'tool-sast')!;
    expect(adapter.executable).toBe('opengrep');
    expect(adapter.args).not.toContain('auto');
    expect(adapter.args.join(' ')).not.toMatch(/\bp\/|r\/|--metrics/);
    expect(adapter.needsRules).toBe(true);
  });

  it('needs no network, so a local-only project runs it (and runs it with the network off)', async () => {
    const flags: boolean[] = [];
    const checks = await runSecurityChecks(
      options({
        networkPolicy: 'local-only',
        runTool: async (adapter, _args, opts) => {
          if (adapter.checkId === 'tool-sast') flags.push(opts.allowNetwork);
          return run({ stdout: '{"results":[]}' });
        },
      }),
    );
    expect(sast(checks).status).toBe('passed');
    expect(flags).toEqual([false]);
  });

  it('records the pinned rule digest, so a verdict names the rules it was about', async () => {
    const checks = await runSecurityChecks(options());
    expect(sast(checks).ruleDigest).toBe('sha256:pinned');
  });

  it('with no ruleset it is NOT RUN (unavailable) and says how to fix it — never a pass, never a registry fallback', async () => {
    const seen: string[][] = [];
    const checks = await runSecurityChecks(
      options({ sastRules: null, runTool: hostLikeRunner(seen) }),
    );
    const result = sast(checks);
    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/not run/i);
    expect(result.reason).toMatch(/DOKIMA_SAST_RULES/);
    expect(result.reason).toMatch(/missing, not clean/);
    expect(seen.some((c) => c[0] === 'opengrep')).toBe(false);
  });

  it('with opengrep missing it is UNAVAILABLE, naming the engine', async () => {
    const checks = await runSecurityChecks(
      options({ isInstalled: (exe) => exe !== 'opengrep' }),
    );
    expect(sast(checks).status).toBe('unavailable');
    expect(sast(checks).reason).toMatch(/opengrep is not installed/);
  });

  it('opengrep findings (exit 1 under --error) are FINDINGS, counted', async () => {
    const checks = await runSecurityChecks(
      options({
        runTool: async (adapter) =>
          adapter.checkId === 'tool-sast'
            ? run({
                exitCode: 1,
                stdout: JSON.stringify({
                  results: [
                    { check_id: 'x.rule-a', path: 'a.ts', extra: { lines: 'eval(x)' } },
                  ],
                }),
              })
            : run(),
      }),
    );
    expect(sast(checks)).toMatchObject({ status: 'findings', findingCount: 1 });
  });
});

/**
 * OPT-IN SMOKE (`DOKIMA_TEST_REAL_SCANNERS=1` with `DOKIMA_SAST_RULES` set):
 * the real opengrep, through the real sandboxed runner with the network
 * denied, over a planted command injection. The only test here that proves
 * the engine detects anything and that the sandbox lets it run.
 */
const realSast =
  process.env.DOKIMA_TEST_REAL_SCANNERS === '1' && process.env.DOKIMA_SAST_RULES
    ? describe
    : describe.skip;

realSast('opt-in: opengrep over the pinned rules, sandboxed', () => {
  it('finds a planted command injection with the network denied, and passes the clean tree', async () => {
    const { promises: fs } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { resolveSastRules } = await import('./sast-rules.js');
    const { sandboxedToolRunner, executableIsInstalled } =
      await import('./security-checks.js');
    const rules = await resolveSastRules(process.env);
    expect(rules).not.toBeNull();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-smoke-sast-'));
    try {
      const scan = () =>
        runSecurityChecks({
          cwd: dir,
          sourceDigest: 'sha256:smoke',
          profile: {
            hasNodeManifest: false,
            hasLockfile: false,
            hasInfrastructureAsCode: false,
          },
          networkPolicy: 'local-only',
          secretsValidatorPath: null,
          sastRules: rules,
          runTool: sandboxedToolRunner(),
          isInstalled: executableIsInstalled,
        });
      await fs.writeFile(
        path.join(dir, 'ok.ts'),
        'export const add = (a: number, b: number) => a + b;\n',
      );
      expect(sast(await scan()).status).toBe('passed');
      await fs.writeFile(
        path.join(dir, 'bad.ts'),
        "import { exec } from 'child_process';\nexport function run(req: any) { exec('ls ' + req.query.dir); }\n",
      );
      const dirty = sast(await scan());
      expect(dirty.status).toBe('findings');
      expect(dirty.findingCount).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
