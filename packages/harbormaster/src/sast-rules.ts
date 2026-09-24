/**
 * Where the SAST ruleset comes from (W23-51, W23-60).
 *
 * THE FOUNDER'S CALLS. 2026-09-23: static analysis runs on Opengrep over local
 * rules. Never Semgrep's registry (`--config auto`, `p/*`) — those rules are
 * licensed for internal use only — and never a run that sends metrics.
 * `--config auto` was also simply broken: semgrep refuses it with
 * `--metrics=off` ("Cannot create auto config when metrics are off").
 * 2026-09-24: ship an open baseline, so a fresh install runs SAST at all.
 *
 * RESOLUTION ORDER, first that applies:
 *  1. `DOKIMA_SAST_RULES`, when set. A set path with no rules is null (NOT RUN)
 *     — an explicit setting that does not resolve is a misconfiguration to
 *     report, never one to paper over with the baseline. The test suite relies
 *     on this: it pins the variable to a missing path so no test spawns a real
 *     scan (W23-59).
 *  2. `~/.dokima/rules/sast`, when it holds rules — where a richer pack is
 *     plugged in (the founder links his proprietary bpm-rulepacks here).
 *  3. The bundled baseline, `rules/sast-baseline/` in the package: rules
 *     written clean-room for Dokima under Apache-2.0 (W23-60). The packs of
 *     step 2 are not vendored — they are proprietary, and this package is FSL.
 *
 * A directory laid out like bpm-rulepacks' `packs/` contributes its security
 * packs only (`owasp`, `secrets`, `framework`) — the code-health packs judge
 * style, and a style finding is not a security check's business. Any other
 * directory is used whole.
 *
 * PINNED BY CONTENT. The digest covers every rule file's path and bytes, and
 * is recorded in each SAST evidence row and in its reuse key, so a verdict
 * says exactly which rules it was about and an edited rule is a changed check.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAsset } from '@dokima/shared';

/** The rulepack subdirectories a security review runs, when the layout has them. */
export const SAST_SECURITY_PACKS: readonly string[] = Object.freeze([
  'owasp',
  'secrets',
  'framework',
]);

export const SAST_RULES_ENV = 'DOKIMA_SAST_RULES';

/** Which step of the resolution order supplied the ruleset. */
export type SastRulesSource = 'env' | 'home' | 'bundled';

export interface SastRuleset {
  /** The directory that was resolved, for messages. */
  readonly root: string;
  /** Absent on a hand-built ruleset (tests); resolveSastRules always sets it. */
  readonly source?: SastRulesSource;
  /** Each passed to the engine as its own `--config`. */
  readonly configPaths: readonly string[];
  /** `sha256:` over every rule file's relative path and content. */
  readonly digest: string;
  readonly ruleFileCount: number;
}

/** Where a ruleset is looked for, in order. Pure, so doctor and the runner agree. */
export function sastRulesLocation(env: Readonly<Record<string, string | undefined>>): {
  readonly dir: string;
  readonly fromEnv: boolean;
} {
  const configured = env[SAST_RULES_ENV]?.trim();
  if (configured) return { dir: path.resolve(configured), fromEnv: true };
  const home = env.HOME?.trim() || os.homedir();
  return { dir: path.join(home, '.dokima', 'rules', 'sast'), fromEnv: false };
}

/** The open baseline shipped in the package (W23-60). */
export function bundledSastRulesDir(): string {
  return resolveAsset('rules', 'sast-baseline');
}

/** The one sentence every "no ruleset" message shares. */
export function sastRulesFix(): string {
  return (
    `set ${SAST_RULES_ENV} to a rulepack directory that exists, or unset it to use ` +
    `~/.dokima/rules/sast or the bundled baseline. Registry rules are never used.`
  );
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function ruleFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
    }
  };
  await walk(dir);
  return out;
}

async function rulesetAt(
  dir: string,
  source: SastRulesSource,
): Promise<SastRuleset | null> {
  if (!(await isDirectory(dir))) return null;

  const packs: string[] = [];
  for (const pack of SAST_SECURITY_PACKS) {
    if (await isDirectory(path.join(dir, pack))) packs.push(path.join(dir, pack));
  }
  const configPaths = packs.length > 0 ? packs : [dir];

  const files = (await Promise.all(configPaths.map(ruleFiles))).flat();
  if (files.length === 0) return null;

  const hash = createHash('sha256');
  for (const file of files.map((f) => path.relative(dir, f)).sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(await fs.readFile(path.join(dir, file)));
    hash.update('\0');
  }
  return {
    root: dir,
    source,
    configPaths,
    digest: `sha256:${hash.digest('hex')}`,
    ruleFileCount: files.length,
  };
}

/**
 * Resolves the ruleset in the order above, or null — which the runner reports
 * as a check that did NOT RUN, never as a pass and never as a registry
 * fallback. Null now means only that DOKIMA_SAST_RULES names a path with no
 * rules (or the package lost its baseline).
 */
export async function resolveSastRules(
  env: Readonly<Record<string, string | undefined>>,
): Promise<SastRuleset | null> {
  const { dir, fromEnv } = sastRulesLocation(env);
  if (fromEnv) return rulesetAt(dir, 'env');
  return (await rulesetAt(dir, 'home')) ?? rulesetAt(bundledSastRulesDir(), 'bundled');
}
