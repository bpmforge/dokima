import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ValidatorSpec } from './run.js';

/**
 * Matches `validate-*.sh` / `run-*.sh` (the general pack convention) plus the
 * literal `secrets-scan.sh` (W3-13, BLUEPRINT §12.5 item 5): that scanner's
 * own header comment documents why it can't use either prefix (this file's
 * write_scope and W3-13's write_scope were mutually incompatible at the
 * time), so it's named as a one-off exception here instead (W3-01b).
 */
const VALIDATOR_NAME_RE = /^(?:(?:validate|run)-.+|secrets-scan)\.sh$/;

export class UnknownValidatorSelectionError extends Error {
  constructor(missing: readonly string[]) {
    super(`selected validator(s) not found in pack: ${missing.join(', ')}`);
    this.name = 'UnknownValidatorSelectionError';
  }
}

export interface LoadValidatorPackOptions {
  /** Directory to discover validator executables in — normally `content/validators`. */
  contentDir: string;
  /** FR-S1 per-project selection: validator names to include; omit to load the whole pack. */
  select?: readonly string[];
}

/**
 * Discovers validator executables (`validate-*.sh` / `run-*.sh`) in
 * `contentDir`, excluding the shared `_lib*.sh` libraries those scripts
 * source (they don't match the naming pattern and aren't independently
 * runnable). `select` implements per-project pack selection (FR-S1,
 * `.dokima/settings.json` validator-pack selection) — an unknown name
 * is a config error, not something to skip silently.
 */
export async function loadValidatorPack(
  opts: LoadValidatorPackOptions,
): Promise<ValidatorSpec[]> {
  const entries = await fs.readdir(opts.contentDir, { withFileTypes: true });
  const specs = entries
    .filter((entry) => entry.isFile() && VALIDATOR_NAME_RE.test(entry.name))
    .map((entry) => ({
      name: entry.name.replace(/\.sh$/, ''),
      path: path.join(opts.contentDir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!opts.select) return specs;

  const bySpecName = new Map(specs.map((spec) => [spec.name, spec]));
  const missing = opts.select.filter((name) => !bySpecName.has(name));
  if (missing.length > 0) {
    throw new UnknownValidatorSelectionError(missing);
  }

  return opts.select.map((name) => {
    const spec = bySpecName.get(name);
    if (!spec) throw new UnknownValidatorSelectionError([name]);
    return spec;
  });
}
