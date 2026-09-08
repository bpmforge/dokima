#!/usr/bin/env node
/**
 * gate-plan.mjs — the six source validators, at the same time (W23-15, AB-15).
 *
 * `run-validators.mjs` runs them in turn and says why: "they are seconds
 * apart, and a serial run means the first failure is the one you read". The
 * first half of that stopped being true as the repo grew — the six now take
 * long enough that a person waits on them — and the second half is a PROPERTY
 * OF THE OUTPUT, not of the scheduling. So this runs them concurrently and
 * prints them in the configured order regardless of who finishes first: the
 * first failure you read is still the first one in the list.
 *
 * ONLY READ-ONLY SOURCE CHECKS ARE IN HERE (step 2). Every validator in the
 * list asks a question about the repo's source and writes nothing, which is
 * what makes running them at once safe. `validate-temp-leaks` is deliberately
 * absent for the reason W22-18 already recorded: it inspects the MACHINE, and
 * a check that reads the tmpdir while other processes are live would read
 * their working directories as leaks. It runs after everything settles.
 *
 * THE RATCHETS COME FROM THE SAME PLACE (W22-06). `ratchetArgsByValidator`
 * reads `conductor.config.json`, and this file imports that function rather
 * than reimplementing it — a second copy of those numbers is how the serial
 * gate came to enforce 49 against a measured 47, in a repo where the other
 * caller was passing the real ones.
 *
 * NOTHING WAS REMOVED TO MAKE THIS FASTER. Same validators, same arguments,
 * same exit rule: nonzero if any child fails.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratchetArgsByValidator, VALIDATORS } from './run-validators.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The default bound. Six checks, and a laptop that is also running a test suite. */
export const DEFAULT_CONCURRENCY = 4;

/**
 * What will run, in the order it will be REPORTED. Built before anything is
 * spawned so the plan can be asserted without executing a thing.
 */
export function gatePlan(
  validators = VALIDATORS,
  ratchetArgs = ratchetArgsByValidator(),
) {
  return validators.map((name) => ({
    name,
    script: `scripts/${name}.mjs`,
    args: ratchetArgs.get(name) ?? [],
  }));
}

/** Runs one entry. Injectable so the tests are tests, not a second full gate. */
function runOne(entry) {
  return new Promise((resolve) => {
    const child = spawn('node', [entry.script, ...entry.args], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (status) => resolve({ ...entry, status, stdout, stderr }));
    child.on('error', (err) =>
      resolve({ ...entry, status: 1, stdout, stderr: `${stderr}${err.message}` }),
    );
  });
}

/**
 * Runs the plan with at most `concurrency` children alive at once, and returns
 * the results IN PLAN ORDER — never completion order, which would make the
 * output of a green run differ from one machine to the next.
 */
export async function runGatePlan(options = {}) {
  const plan = options.plan ?? gatePlan();
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const execute = options.run ?? runOne;
  const results = new Array(plan.length);
  let next = 0;
  let peak = 0;
  let live = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= plan.length) return;
      live += 1;
      peak = Math.max(peak, live);
      results[index] = await execute(plan[index]);
      live -= 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.length) }, () => worker()),
  );
  return { results, peakConcurrency: peak };
}

/**
 * The same lines the serial runner prints, including the REPORT: pass-through
 * a passing validator uses to say something without failing the build. Kept
 * identical on purpose: the two are compared for equivalence, and a difference
 * in the report is a difference.
 */
export function formatResults(results) {
  const lines = [];
  for (const result of results) {
    const ok = result.status === 0;
    const args = result.args.length ? ` (${result.args.join(' ')})` : '';
    lines.push(`${ok ? '  ok  ' : ' FAIL '} ${result.name}${args}`);
    if (ok) {
      for (const line of (result.stdout ?? '').split('\n')) {
        if (line.startsWith('REPORT:')) lines.push(`       ${line.slice(7).trim()}`);
        else if (line.startsWith('REPORT-CONT:'))
          lines.push(`         ${line.slice(12)}`);
      }
    } else {
      const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
      if (out) lines.push(...out.split('\n').slice(-25), '');
    }
  }
  return lines;
}

async function main() {
  const started = Date.now();
  const { results } = await runGatePlan();
  for (const line of formatResults(results)) process.stdout.write(`${line}\n`);
  const failed = results.filter((r) => r.status !== 0).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed > 0) {
    process.stdout.write(`\n${failed} validator(s) failed. (${seconds}s)\n`);
    process.exit(1);
  }
  process.stdout.write(`\nall ${results.length} validators clean. (${seconds}s)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
