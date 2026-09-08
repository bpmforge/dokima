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
 * placeholders, `{cwd}` and `{validatorPath}`, both runtime-owned paths.
 */

import { createHash } from 'node:crypto';
import type { SecurityToolAdapter } from './security-checks.js';

export const digestOfText = (text: string): string =>
  `sha256:${createHash('sha256').update(text).digest('hex')}`;

/** Semgrep: 0 clean, 1 findings, anything else is the tool failing, not the code passing. */
const SAST: SecurityToolAdapter = {
  checkId: 'tool-sast',
  executable: 'semgrep',
  args: ['--config', 'auto', '--json', '--quiet', '--metrics=off', '--error', '.'],
  requiresNetwork: false,
  applicable: () => ({ applicable: true, reason: null }),
  interpret: (run) => {
    if (run.timedOut) {
      return {
        status: 'error',
        reason: 'semgrep did not finish inside its deadline',
        findingCount: 0,
      };
    }
    if (run.exitCode === null) {
      return {
        status: 'unavailable',
        reason: 'semgrep is not installed on this host',
        findingCount: 0,
      };
    }
    if (run.exitCode !== 0 && run.exitCode !== 1) {
      return {
        status: 'error',
        reason: `semgrep exited ${run.exitCode} before scanning: ${run.stderr.slice(0, 200)}`,
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
        reason: 'semgrep output was not valid JSON',
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

const SECRETS: SecurityToolAdapter = {
  checkId: 'tool-secrets',
  executable: 'bash',
  args: ['{validatorPath}', '{cwd}'],
  requiresNetwork: false,
  applicable: () => ({ applicable: true, reason: null }),
  interpret: (run) => {
    if (run.timedOut)
      return { status: 'error', reason: 'the secrets scan timed out', findingCount: 0 };
    if (run.exitCode === 0) return { status: 'passed', reason: null, findingCount: 0 };
    if (run.exitCode === 1) {
      const count = run.stdout.split('\n').filter((l) => /^\s*-\s/.test(l)).length;
      return { status: 'findings', reason: null, findingCount: Math.max(count, 1) };
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
