#!/usr/bin/env node
/**
 * check-validator-fixtures.mjs — red/green fixture harness for the conductor's
 * content validators (P2-08; pattern ported from attest's
 * scripts/check-validator-fixtures.mjs, T22.5).
 *
 * A GATE validator (conductor.config.json `validators.gate[]`) blocks tickets,
 * so it must be proven failing-capable: a `red` fixture is a small project
 * tree the validator must find >=1 gap in (exit 1), a `green` fixture is one
 * it must pass clean (exit 0). A green-only fixture proves nothing about
 * whether the check fires, so BOTH are mandatory for every gate validator —
 * and gate validators may never be grandfathered.
 *
 * ADVISORY validators (`validators.advisory[]`) may instead appear in
 * content/validators/fixtures/GRANDFATHERED.json. That list may only shrink:
 *   - an entry whose red fixture now exists is stale and FAILS the check
 *     (remove the entry — this is how a validator graduates toward gate[]);
 *   - an entry naming a gate validator or an unknown name FAILS;
 *   - an entry absent from the committed (HEAD) copy of the file FAILS —
 *     growth cannot be smuggled in alongside the change it excuses.
 *
 * Fixture layout: content/validators/fixtures/<name>/{red,green}/ — each side
 * is a project root handed to the validator as its positional argument, the
 * same whole-tree mode `bash content/validators/<name>.sh <dir>` uses.
 * EXPERTS_TELEMETRY=0 keeps _lib.sh from writing docs/work/telemetry.jsonl
 * into the fixture trees, and PROJECT_ROOT is stripped so an inherited value
 * cannot silently repoint every run at the caller's repo.
 *
 * Usage: node scripts/check-validator-fixtures.mjs [--json] [--root <dir>]
 * Exit 0 clean / 1 failures / 2 checker self-error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const opts = { json: false, root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--root') opts.root = path.resolve(argv[++i] ?? '.');
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return opts;
}

function readConfig(root) {
  const config = JSON.parse(
    readFileSync(path.join(root, 'conductor.config.json'), 'utf8'),
  );
  const validators = config.validators ?? {};
  return {
    dir: path.join(root, validators.dir ?? 'content/validators'),
    gate: validators.gate ?? [],
    advisory: validators.advisory ?? [],
  };
}

/**
 * The committed grandfather list, so growth in the working tree is visible.
 * Absent history (file not yet committed, or no git repo — the negative-case
 * temp trees in the tests) means there is nothing to have grown from.
 */
export function committedGrandfatherList(root, relPath) {
  try {
    const out = execFileSync('git', ['-C', root, 'show', `HEAD:${relPath}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function runValidator(scriptPath, fixtureDir) {
  const env = { ...process.env, EXPERTS_TELEMETRY: '0' };
  delete env.PROJECT_ROOT;
  try {
    execFileSync('bash', [scriptPath, fixtureDir], {
      stdio: 'pipe',
      encoding: 'utf8',
      env,
    });
    return 0;
  } catch (err) {
    return typeof err.status === 'number' ? err.status : 2;
  }
}

/** Checks one validator's fixture pair; returns result rows (FAIL rows count). */
function checkFixturePair(name, scriptPath, fixturesDir) {
  const redDir = path.join(fixturesDir, name, 'red');
  const greenDir = path.join(fixturesDir, name, 'green');
  const rows = [];
  const redExit = runValidator(scriptPath, redDir);
  if (redExit !== 1) {
    rows.push({
      validator: name,
      status: 'FAIL',
      reason: `red fixture did not fail: exit ${redExit} against ${name}/red (want 1)`,
    });
  }
  if (existsSync(greenDir)) {
    const greenExit = runValidator(scriptPath, greenDir);
    if (greenExit !== 0) {
      rows.push({
        validator: name,
        status: 'FAIL',
        reason: `green fixture did not pass: exit ${greenExit} against ${name}/green (want 0)`,
      });
    }
  }
  if (rows.length === 0) rows.push({ validator: name, status: 'OK' });
  return rows;
}

export function checkFixtures(root) {
  const { dir, gate, advisory } = readConfig(root);
  const fixturesDir = path.join(dir, 'fixtures');
  const grandfatherPath = path.join(fixturesDir, 'GRANDFATHERED.json');
  const grandfathered = existsSync(grandfatherPath)
    ? new Set(JSON.parse(readFileSync(grandfatherPath, 'utf8')))
    : new Set();
  const results = [];

  for (const name of gate) {
    const scriptPath = path.join(dir, `${name}.sh`);
    const redDir = path.join(fixturesDir, name, 'red');
    const greenDir = path.join(fixturesDir, name, 'green');
    if (grandfathered.has(name)) {
      results.push({
        validator: name,
        status: 'FAIL',
        reason:
          'gate validators may never be grandfathered — a blocking check must prove it can go red',
      });
      continue;
    }
    if (!existsSync(redDir) || !existsSync(greenDir)) {
      results.push({
        validator: name,
        status: 'FAIL',
        reason: `gate validator is missing its ${existsSync(redDir) ? 'green' : 'red'} fixture (${name}/{red,green} are both mandatory)`,
      });
      continue;
    }
    results.push(...checkFixturePair(name, scriptPath, fixturesDir));
  }

  for (const name of advisory) {
    const scriptPath = path.join(dir, `${name}.sh`);
    const redDir = path.join(fixturesDir, name, 'red');
    if (!existsSync(redDir)) {
      if (grandfathered.has(name)) {
        results.push({ validator: name, status: 'GRANDFATHERED' });
      } else {
        results.push({
          validator: name,
          status: 'FAIL',
          reason:
            'advisory validator has no red fixture and is not on the grandfather list (which may only shrink — write fixtures instead)',
        });
      }
      continue;
    }
    if (grandfathered.has(name)) {
      results.push({
        validator: name,
        status: 'FAIL',
        reason:
          'has a red fixture now but is still grandfathered — remove the entry (list may only shrink)',
      });
      continue;
    }
    results.push(...checkFixturePair(name, scriptPath, fixturesDir));
  }

  const known = new Set([...gate, ...advisory]);
  for (const entry of grandfathered) {
    if (!known.has(entry)) {
      results.push({
        validator: entry,
        status: 'FAIL',
        reason:
          'grandfather entry names no configured gate/advisory validator — remove it',
      });
    }
  }

  const committed = committedGrandfatherList(root, path.relative(root, grandfatherPath));
  if (committed !== null) {
    const committedSet = new Set(committed);
    for (const entry of grandfathered) {
      if (!committedSet.has(entry)) {
        results.push({
          validator: entry,
          status: 'FAIL',
          reason:
            'grandfather list GREW vs the committed file — the list may only shrink',
        });
      }
    }
  }

  // A fixture directory whose name is no configured validator would be
  // silently skipped by the loops above — surface it (warning, not failure:
  // it gates nothing, but it is probably a typo).
  const unknownFixtureDirs = existsSync(fixturesDir)
    ? readdirSync(fixturesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !known.has(d.name))
        .map((d) => d.name)
    : [];

  const failures = results.filter((r) => r.status === 'FAIL');
  return { gate, advisory, results, failures, unknownFixtureDirs };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const summary = checkFixtures(opts.root);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`gate validators: ${summary.gate.length}`);
    console.log(`advisory validators: ${summary.advisory.length}`);
    for (const r of summary.results) {
      if (r.status === 'FAIL') console.error(`  [FAIL] ${r.validator}: ${r.reason}`);
      else console.log(`  [${r.status}] ${r.validator}`);
    }
    for (const name of summary.unknownFixtureDirs) {
      console.error(`  ! fixture dir for unconfigured validator: ${name}`);
    }
    console.log(
      summary.failures.length === 0 ? 'clean' : `${summary.failures.length} failure(s)`,
    );
  }
  process.exit(summary.failures.length > 0 ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(
      `check-validator-fixtures: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(2);
  }
}
