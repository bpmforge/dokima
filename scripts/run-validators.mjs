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

/** Every validator that must pass. Add one here the day it starts passing, not before. */
const VALIDATORS = [
  'validate-plan',
  'validate-traceability',
  'validate-ui-copy',
  'validate-exports',
  'validate-volatile-paths',
  'validate-history-secrets',
];

let failed = 0;
for (const name of VALIDATORS) {
  const result = spawnSync('node', [`scripts/${name}.mjs`], { encoding: 'utf8' });
  const ok = result.status === 0;
  process.stdout.write(`${ok ? '  ok  ' : ' FAIL '} ${name}\n`);
  // A PASSING validator can still have something to say. `validate-plan`'s P12
  // reports acceptance criteria naming a UI surface their write_scope cannot
  // reach — measured at ~13% precision, far too noisy to fail a build on, but
  // worth a human's eyes. Without this, that report printed into a void: a
  // check nobody sees is the L-46/L-47 failure it was written to prevent.
  // The contract is one line: prefix a line with REPORT: and it survives success.
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
