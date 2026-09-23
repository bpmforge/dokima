/**
 * Where the SAST ruleset comes from (W23-51).
 *
 * THE FOUNDER'S CALL, recorded 2026-09-23: static analysis runs on Opengrep
 * with the founder's own rule packs (bpm-rulepacks). Never Semgrep's registry
 * (`--config auto`, `p/*`) — those rules are licensed for internal use only —
 * and never a run that sends metrics. `--config auto` was also simply broken:
 * semgrep refuses it with `--metrics=off` ("Cannot create auto config when
 * metrics are off"), so every machine review carried an errored SAST check.
 *
 * THE RULES ARE NOT VENDORED. They are proprietary and this package is
 * published under FSL, so the ruleset is located on the host instead:
 * `DOKIMA_SAST_RULES` when set, else `~/.dokima/rules/sast`. A directory laid
 * out like bpm-rulepacks' `packs/` contributes its security packs only
 * (`owasp`, `secrets`, `framework`) — the code-health packs judge style, and a
 * style finding is not a security check's business. Any other directory is
 * used whole.
 *
 * PINNED BY CONTENT. The digest covers every rule file's path and bytes, and
 * is recorded in each SAST evidence row and in its reuse key, so a verdict
 * says exactly which rules it was about and an edited rule is a changed check.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The rulepack subdirectories a security review runs, when the layout has them. */
export const SAST_SECURITY_PACKS: readonly string[] = Object.freeze([
  'owasp',
  'secrets',
  'framework',
]);

export const SAST_RULES_ENV = 'DOKIMA_SAST_RULES';

export interface SastRuleset {
  /** The directory that was resolved, for messages. */
  readonly root: string;
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

/** The one sentence every "no ruleset" message shares. */
export function sastRulesFix(): string {
  return (
    `set ${SAST_RULES_ENV} to a rulepack directory (for bpm-rulepacks, its packs/ ` +
    `directory), or link one at ~/.dokima/rules/sast. Registry rules are never used.`
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

/**
 * Resolves the ruleset, or null when there is none — which the runner reports
 * as a check that did NOT RUN, never as a pass and never as a registry fallback.
 */
export async function resolveSastRules(
  env: Readonly<Record<string, string | undefined>>,
): Promise<SastRuleset | null> {
  const { dir } = sastRulesLocation(env);
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
    configPaths,
    digest: `sha256:${hash.digest('hex')}`,
    ruleFileCount: files.length,
  };
}
