#!/usr/bin/env node
/**
 * run-validators.mjs — the repo's own mechanical checks, in one command.
 *
 * Six validators existed and gated NOTHING. Law 3 is lint + typecheck + test +
 * e2e; none of these ran unless a person remembered, and `validate-plan` was
 * consequently RED for an entire session — 53 violations, mostly acceptance
 * criteria written into `notes` where no mechanical check could see them.
 *
 * That is the same shape as the capture tour (W21-92) and the SAST script
 * (W21-98): a real check nobody runs decays into a check nobody can trust.
 * Law 3 now calls this, so they fail with the gate instead of rotting quietly.
 *
 * Each is run in turn rather than in parallel: they are seconds apart, and a
 * serial run means the first failure is the one you read.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ratchet arguments each validator is gated with — read from
 * `conductor.config.json`, which is the ONLY place they are written (W22-06).
 *
 * This command ran every validator with NO arguments, so `validate-exports`
 * always exited 0 here no matter what its count was: its two baselines are
 * passed as `--max` / `--max-buried`, and without them the ratchet has no
 * number to exceed. Meanwhile the per-ticket conductor gate passed the real
 * ones. The same validator was therefore ENFORCING in one place and merely
 * reporting in the other — and the two had already drifted, with a configured
 * 49 against a measured 47.
 *
 * That is the L-47 shape one level up: not a check nobody runs, but a check
 * that runs without its teeth. Reading the same config both callers use is
 * what makes "one place" true rather than aspirational — a second copy of the
 * numbers here would drift again the first time either moved.
 */
export function ratchetArgsByValidator() {
  const configPath = path.join(ROOT, 'conductor.config.json');
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    // REFUSE rather than silently fall back to no arguments. A fallback here
    // would restore the exact defect this function exists to remove, and it
    // would do it quietly — every validator would pass, and the output would
    // look identical to a healthy run.
    process.stdout.write(
      `FAIL: cannot read ${path.relative(ROOT, configPath)} — the validator ` +
        `baselines live there, and running without them would silently ` +
        `disable every ratchet.\n  ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
  const byName = new Map();
  for (const gate of config.gates ?? []) {
    if (!Array.isArray(gate) || gate[0] !== 'node' || !Array.isArray(gate[1])) continue;
    const [script, ...args] = gate[1];
    const match = /^scripts\/(.+)\.mjs$/.exec(script ?? '');
    if (match) byName.set(match[1], args);
  }
  return byName;
}

/** Every validator that must pass. Add one here the day it starts passing, not before. */
export const VALIDATORS = [
  'validate-plan',
  'validate-traceability',
  'validate-ui-copy',
  'validate-exports',
  'validate-volatile-paths',
  'validate-history-secrets',
  // NOT validate-temp-leaks (W22-18). It belongs to `pnpm validate` but not to
  // THIS list: run-validators.test.mjs executes this script as a test, so a
  // check that inspects the machine's tmpdir would run DURING the test run and
  // read other vitest workers' live temp directories as leaks. Every validator
  // here asks a question about the repo's SOURCE, which is why executing them
  // mid-run is safe. See package.json's `validate` script.
];

function main() {
  const RATCHET_ARGS = ratchetArgsByValidator();
  let failed = 0;
  for (const name of VALIDATORS) {
    // A validator the conductor gate does not list, or lists with no
    // arguments, runs exactly as it did before. Only the ratcheted ones gain
    // their numbers.
    const args = RATCHET_ARGS.get(name) ?? [];
    const result = spawnSync('node', [`scripts/${name}.mjs`, ...args], { encoding: 'utf8' });
    const ok = result.status === 0;
    process.stdout.write(
      `${ok ? '  ok  ' : ' FAIL '} ${name}${args.length ? ` (${args.join(' ')})` : ''}\n`,
    );
    // A PASSING validator can still have something to say. `validate-plan`'s
    // P12 reports acceptance criteria naming a UI surface their write_scope
    // cannot reach — measured at ~13% precision, far too noisy to fail a build
    // on, but worth a human's eyes. Without this, that report printed into a
    // void: a check nobody sees is the L-46/L-47 failure it was written to
    // prevent. The contract is one line: prefix REPORT: and it survives success.
    if (ok) {
      for (const line of (result.stdout ?? '').split('\n')) {
        if (line.startsWith('REPORT:')) process.stdout.write(`       ${line.slice(7).trim()}\n`);
        else if (line.startsWith('REPORT-CONT:')) process.stdout.write(`         ${line.slice(12)}\n`);
      }
    }
    if (!ok) {
      failed += 1;
      // The failing validator's own words, not a generic "it failed" — these
      // scripts already name the ticket and the line.
      const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
      if (out) process.stdout.write(`${out.split('\n').slice(-25).join('\n')}\n\n`);
    }
  }

  if (failed > 0) {
    process.stdout.write(`\n${failed} validator(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nall ${VALIDATORS.length} validators clean.\n`);
}

// Same idiom validate-exports.mjs uses. Safe here because this script is only
// ever invoked directly (`pnpm validate` -> `node scripts/run-validators.mjs`),
// never imported by a wrapper that would make argv[1] a different file — the
// trap W22-01 hit with cli-entry.mjs importing the bundle.
if (import.meta.url === `file://${process.argv[1]}`) main();
