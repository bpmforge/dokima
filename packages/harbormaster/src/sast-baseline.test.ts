/**
 * W23-60 — the bundled open SAST baseline.
 *
 * Before this ticket the ruleset came only from DOKIMA_SAST_RULES or
 * ~/.dokima/rules/sast. The founder's rule packs are proprietary and not
 * shipped, so on every install but his, tool-sast was NOT RUN and no ticket
 * could be machine-accepted. The founder's call (2026-09-24): ship an open
 * baseline in the package and fall back to it.
 *
 * HERMETIC. Every resolution here passes its own HOME (a fresh temp dir) and
 * never reads process.env, so the result does not depend on this machine's
 * ~/.dokima/rules/sast symlink (W23-59) or on the suite's DOKIMA_SAST_RULES
 * pin in vitest.network-guard.ts.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveAsset } from '@dokima/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { executableIsInstalled } from './security-tool-runner.js';
import {
  runSecurityChecks,
  type RunSecurityChecksOptions,
  type ToolRunResult,
} from './security-checks.js';
import { resolveSastRules } from './sast-rules.js';

const BASELINE = resolveAsset('rules', 'sast-baseline');
const FIXTURES = resolveAsset('rules', 'sast-baseline-fixtures');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function emptyHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-sast-baseline-home-'));
  dirs.push(home);
  return home;
}

const run = (over: Partial<ToolRunResult> = {}): ToolRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  durationMs: 1,
  ...over,
});

describe('W23-60: with no ruleset configured, tool-sast runs on the bundled baseline', () => {
  it('RED: no DOKIMA_SAST_RULES and an empty HOME — tool-sast RUNS on the baseline instead of reporting NOT RUN', async () => {
    const home = await emptyHome();
    const rules = await resolveSastRules({ HOME: home });

    const seen: string[][] = [];
    const options: RunSecurityChecksOptions = {
      cwd: '/work/tree',
      sourceDigest: 'sha256:head',
      profile: {
        hasNodeManifest: false,
        hasLockfile: false,
        hasInfrastructureAsCode: false,
      },
      networkPolicy: 'local-only',
      secretsValidatorPath: '/opt/secrets-scan.sh',
      sastRules: rules,
      runTool: async (adapter, args) => {
        seen.push([adapter.executable, ...args]);
        return adapter.checkId === 'tool-sast'
          ? run({ stdout: '{"results":[],"errors":[]}' })
          : run();
      },
      isInstalled: () => true,
    };
    const checks = await runSecurityChecks(options);
    const sast = checks.find((c) => c.checkId === 'tool-sast')!;

    expect(sast.status).toBe('passed');
    const command = seen.find((c) => c[0] === 'opengrep')!;
    expect(command[command.indexOf('--config') + 1]).toBe(BASELINE);
    expect(rules).toMatchObject({ source: 'bundled', root: BASELINE });
  });
});

describe('W23-60: resolution order', () => {
  it('DOKIMA_SAST_RULES, when set, wins over HOME and the baseline', async () => {
    const home = await emptyHome();
    await fs.mkdir(path.join(home, '.dokima', 'rules', 'sast'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.dokima', 'rules', 'sast', 'h.yaml'),
      'rules: []',
    );
    const mine = await emptyHome();
    await fs.writeFile(path.join(mine, 'mine.yaml'), 'rules: []');

    const rules = await resolveSastRules({ DOKIMA_SAST_RULES: mine, HOME: home });
    expect(rules).toMatchObject({ source: 'env', root: mine });
  });

  it('DOKIMA_SAST_RULES set to a path with no rules is NOT RUN, never a silent fall back to the baseline', async () => {
    // An explicit setting that does not resolve is a misconfiguration to
    // report, not one to paper over — and it is how the suite (W23-59) keeps
    // every test from spawning a real scan.
    const home = await emptyHome();
    expect(
      await resolveSastRules({ DOKIMA_SAST_RULES: '/definitely/not/here', HOME: home }),
    ).toBeNull();
  });

  it('~/.dokima/rules/sast, when it holds rules, wins over the baseline', async () => {
    const home = await emptyHome();
    const dir = path.join(home, '.dokima', 'rules', 'sast');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'h.yaml'), 'rules: []');
    expect(await resolveSastRules({ HOME: home })).toMatchObject({
      source: 'home',
      root: dir,
    });
  });

  it('an empty ~/.dokima/rules/sast falls through to the baseline', async () => {
    const home = await emptyHome();
    await fs.mkdir(path.join(home, '.dokima', 'rules', 'sast'), { recursive: true });
    expect(await resolveSastRules({ HOME: home })).toMatchObject({ source: 'bundled' });
  });
});

/** Rule ids per rule file, read from the YAML without a parser (`  - id: x`). */
async function ruleIds(file: string): Promise<string[]> {
  const text = await fs.readFile(file, 'utf8');
  return [...text.matchAll(/^ {2}- id: (\S+)$/gm)].map((m) => m[1] as string);
}

async function ruleFiles(): Promise<string[]> {
  return (await fs.readdir(BASELINE)).filter((f) => f.endsWith('.yaml')).sort();
}

async function fixturesFor(ruleFile: string): Promise<string[]> {
  const stem = ruleFile.replace(/\.yaml$/, '');
  return (await fs.readdir(FIXTURES))
    .filter((f) => f.slice(0, f.lastIndexOf('.')) === stem)
    .map((f) => path.join(FIXTURES, f));
}

describe('W23-60: the baseline itself', () => {
  it('ships 15-30 rules under an Apache-2.0 LICENSE, each file headed as clean-room work', async () => {
    const license = await fs.readFile(path.join(BASELINE, 'LICENSE'), 'utf8');
    expect(license).toMatch(/Apache License\s+Version 2\.0/);
    const files = await ruleFiles();
    const ids = (
      await Promise.all(files.map((f) => ruleIds(path.join(BASELINE, f))))
    ).flat();
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(ids.length).toBeLessThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of files) {
      const head = (await fs.readFile(path.join(BASELINE, f), 'utf8')).slice(0, 300);
      expect(head, f).toMatch(/Apache-2\.0/);
      expect(head, f).toMatch(/clean-room/);
    }
  });

  it('every rule has a positive (ruleid:) and a negative (ok:) fixture', async () => {
    const missing: string[] = [];
    for (const file of await ruleFiles()) {
      const fixtures = await fixturesFor(file);
      const text = (await Promise.all(fixtures.map((f) => fs.readFile(f, 'utf8')))).join(
        '\n',
      );
      for (const id of await ruleIds(path.join(BASELINE, file))) {
        const annotated = (kind: string) =>
          new RegExp(`\\b${kind}:[^\\n]*\\b${id}\\b`).test(text);
        if (!annotated('ruleid')) missing.push(`${id}: no ruleid: fixture`);
        if (!annotated('ok')) missing.push(`${id}: no ok: fixture`);
      }
    }
    expect(missing).toEqual([]);
  });

  // CI installs a pinned opengrep for this (ci.yml), so this runs there too.
  it.skipIf(!executableIsInstalled('opengrep'))(
    'opengrep test passes for every rule file against its fixtures',
    async () => {
      const exec = promisify(execFile);
      const failures: string[] = [];
      await Promise.all(
        (await ruleFiles()).map(async (file) => {
          for (const fixture of await fixturesFor(file)) {
            try {
              const { stdout, stderr } = await exec(
                'opengrep',
                ['test', '--config', path.join(BASELINE, file), fixture],
                { timeout: 60_000 },
              );
              if (!/All tests passed/.test(`${stdout}${stderr}`)) {
                failures.push(`${file} on ${path.basename(fixture)}: ${stdout}${stderr}`);
              }
            } catch (err) {
              const e = err as { stdout?: string; stderr?: string };
              failures.push(
                `${file} on ${path.basename(fixture)}: ${e.stdout ?? ''}${e.stderr ?? ''}`,
              );
            }
          }
        }),
      );
      expect(failures).toEqual([]);
    },
    120_000,
  );
});
