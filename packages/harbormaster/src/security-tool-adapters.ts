/**
 * The tool adapters (W23-04) — one chapter per the 400-line CODE_BOOK_PROTOCOL
 * cap, split out of `security-checks.ts` which owns the runner.
 *
 * EACH ADAPTER OWNS ITS OWN EXIT CODES, and that is the whole reason they are
 * separate objects rather than one switch: Semgrep exits 1 for findings and 2
 * for a bad rule file; `npm audit` exits 1 for advisories and 1 again when it
 * cannot reach the registry; the bundled secrets scanner exits 2 for its own
 * failure. A shared interpretation would have to be wrong for two of the three.
 *
 * Every executable and every argument here is a constant. Nothing a model
 * emits reaches a command line — the runner substitutes exactly two
 * placeholders, `{cwd}` and `{validatorPath}`, both runtime-owned paths, and
 * expands `{sastConfig}` into the pinned ruleset's `--config` paths (W23-51).
 */

import { createHash } from 'node:crypto';
import type { SecurityToolAdapter } from './security-checks.js';
import {
  depsFindingKeys,
  sastFindingKeys,
  secretsFindingKeys,
} from './security-baseline.js';

export const digestOfText = (text: string): string =>
  `sha256:${createHash('sha256').update(text).digest('hex')}`;

/**
 * W23-54: the tool was never started. `sh -c` answers a missing command with
 * exit 127 ("opengrep: not found") — under the container profile the default
 * image has no opengrep, and on the host an executable can vanish between the
 * install probe and the run. That is NOT RUN, never an error about the code
 * and never — as `npm audit`'s empty stdout parsed to — a pass.
 */
function notStarted(
  run: { readonly exitCode: number | null; readonly stderr: string },
  tool: string,
): { status: 'unavailable'; reason: string; findingCount: 0 } | null {
  const missing =
    run.exitCode === 127 ||
    (run.exitCode !== 0 &&
      /command not found|: not found\b|executable file not found/i.test(run.stderr));
  return missing
    ? {
        status: 'unavailable',
        reason: `${tool} could not be started, so it did not run: ${run.stderr.trim().slice(0, 240)}`,
        findingCount: 0,
      }
    : null;
}

/**
 * Opengrep over the founder's own pinned rule packs (W23-51). 0 clean, 1
 * findings (`--error`), anything else is the tool failing, not the code passing.
 *
 * WHAT THIS REPLACED: `semgrep --config auto ... --metrics=off`. `--config auto`
 * pulls Semgrep's registry rules — licensed for internal use only, and the
 * founder's decision is that Dokima never runs them — and current semgrep
 * refuses that pair outright ("Cannot create auto config when metrics are
 * off"), so the check errored on every review on every host. `{sastConfig}`
 * expands to one `--config <dir>` per pinned pack (`sast-rules.ts`); with no
 * ruleset the runner reports NOT RUN before this command is ever built.
 * Opengrep sends no metrics and has no metrics flag; `--disable-version-check`
 * keeps it off the network entirely, which is what lets a local-only project
 * run it.
 */
const SAST: SecurityToolAdapter = {
  checkId: 'tool-sast',
  executable: 'opengrep',
  args: [
    'scan',
    '{sastConfig}',
    '--json',
    '--quiet',
    '--disable-version-check',
    '--error',
    '.',
  ],
  requiresNetwork: false,
  needsRules: true,
  findingKeys: (run) => sastFindingKeys(run.stdout),
  applicable: () => ({ applicable: true, reason: null }),
  interpret: (run) => {
    if (run.timedOut) {
      return {
        status: 'error',
        reason: 'opengrep did not finish inside its deadline',
        findingCount: 0,
      };
    }
    if (run.exitCode === null) {
      return {
        status: 'unavailable',
        reason: `opengrep could not be started on this host, so SAST did not run${run.stderr ? `: ${run.stderr.slice(0, 200)}` : ''}`,
        findingCount: 0,
      };
    }
    const sastMissing = notStarted(run, 'opengrep');
    if (sastMissing) return sastMissing;
    if (run.exitCode !== 0 && run.exitCode !== 1) {
      return {
        status: 'error',
        reason: `opengrep exited ${run.exitCode} before scanning: ${run.stderr.slice(0, 200)}`,
        findingCount: 0,
      };
    }
    let parsed: { results?: unknown[] };
    try {
      parsed = JSON.parse(run.stdout || '{}') as { results?: unknown[] };
    } catch {
      // Exit 0 with unreadable output is the dangerous case: a naive reader
      // calls that a clean scan. It is a scanner whose result nobody can read.
      return {
        status: 'error',
        reason: 'opengrep output was not valid JSON',
        findingCount: 0,
      };
    }
    const findings = Array.isArray(parsed.results) ? parsed.results.length : 0;
    return findings > 0
      ? { status: 'findings', reason: null, findingCount: findings }
      : { status: 'passed', reason: null, findingCount: 0 };
  },
};

/**
 * The bundled secrets scanner. Its contract is its own header's: exit 0 clean,
 * 1 gaps, 2 error — the same 0/1/2 the validator pack uses, which is why this
 * adapter reads exit codes and not prose. It is `bash`-invoked because
 * `content/` is data and git does not reliably preserve an executable bit
 * (the reason `packages/validators/src/run.ts` gives for the same choice).
 */
export const SECRETS_CHECK_ID = 'tool-secrets';

function itemCount(stdout: string): number {
  try {
    const items = (JSON.parse(stdout) as { items?: unknown }).items;
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

const SECRETS: SecurityToolAdapter = {
  checkId: 'tool-secrets',
  executable: 'bash',
  args: ['{validatorPath}', '{cwd}'],
  requiresNetwork: false,
  // W23-55: fingerprinted in memory from the scanned tree, so the W23-51
  // baseline can tell a secret committed at base from one this change adds.
  findingKeys: (run, root) => secretsFindingKeys(run.stdout, root),
  applicable: () => ({ applicable: true, reason: null }),
  interpret: (run) => {
    if (run.timedOut)
      return { status: 'error', reason: 'the secrets scan timed out', findingCount: 0 };
    const secretsMissing = notStarted(run, 'the secrets scanner');
    if (secretsMissing) return secretsMissing;
    if (run.exitCode === 0) return { status: 'passed', reason: null, findingCount: 0 };
    if (run.exitCode === 1) {
      // Its stdout is one JSON envelope (`_lib.sh` validator_exit): count the
      // items. The old count of "- " lines never matched it and was always 1.
      return {
        status: 'findings',
        reason: null,
        findingCount: Math.max(itemCount(run.stdout), 1),
      };
    }
    return {
      status: 'error',
      reason: `the secrets scan failed to run (exit ${run.exitCode}): ${run.stderr.slice(0, 200)}`,
      findingCount: 0,
    };
  },
};

/**
 * `npm audit --json`. Exits 1 both for "advisories found" and for "could not
 * reach the registry", so the payload decides, not the code — and an audit
 * that never reached a database is UNAVAILABLE, never a clean bill of health.
 */
const DEPS: SecurityToolAdapter = {
  checkId: 'tool-deps',
  executable: 'npm',
  args: ['audit', '--json'],
  requiresNetwork: true,
  findingKeys: (run) => depsFindingKeys(run.stdout),
  applicable: (profile) =>
    profile.hasNodeManifest && profile.hasLockfile
      ? { applicable: true, reason: null }
      : {
          applicable: false,
          reason: profile.hasNodeManifest
            ? 'no lockfile, so there is no resolved dependency set to audit'
            : 'no Node package manifest in this project',
        },
  interpret: (run) => {
    if (run.timedOut)
      return { status: 'error', reason: 'npm audit timed out', findingCount: 0 };
    const npmMissing = notStarted(run, 'npm audit');
    if (npmMissing) return npmMissing;
    let parsed: {
      metadata?: { vulnerabilities?: Record<string, number> };
      error?: unknown;
    };
    try {
      parsed = JSON.parse(run.stdout || '{}') as typeof parsed;
    } catch {
      return {
        status: 'unavailable',
        reason: `npm audit produced no readable report (exit ${run.exitCode}); its advisory data was not reached`,
        findingCount: 0,
      };
    }
    if (parsed.error) {
      return {
        status: 'unavailable',
        reason: 'npm audit could not reach its advisory database, so nothing was audited',
        findingCount: 0,
      };
    }
    const counts = parsed.metadata?.vulnerabilities ?? {};
    const total = Object.entries(counts)
      .filter(([severity]) => severity !== 'info')
      .reduce((sum, [, n]) => sum + (typeof n === 'number' ? n : 0), 0);
    return total > 0
      ? { status: 'findings', reason: null, findingCount: total }
      : { status: 'passed', reason: null, findingCount: 0 };
  },
};

export const SECURITY_TOOLS: readonly SecurityToolAdapter[] = Object.freeze([
  SAST,
  SECRETS,
  DEPS,
]);
