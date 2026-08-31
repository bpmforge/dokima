import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(ROOT, 'scripts/check-validator-fixtures.mjs');

/** Runs the checker as a subprocess; returns { status, stdout, stderr }. */
function runChecker(args) {
  try {
    const stdout = execFileSync(process.execPath, [CHECKER, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const tempDirs = [];
function makeTempTree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-p208-fixture-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  // W22-18: validate-temp-leaks hunts leftovers — never leave a temp tree.
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

/**
 * A minimal project tree the checker can run against: one configurable fake
 * validator (`validate-alpha`, gate) that exits 1 iff the fixture tree plants
 * a `defect.txt`, plus optional advisory validators and a grandfather list.
 */
function scaffold(dir, { gate = ['validate-alpha'], advisory = [] } = {}) {
  writeFileSync(
    path.join(dir, 'conductor.config.json'),
    JSON.stringify({ validators: { dir: 'content/validators', gate, advisory } }),
  );
  const validatorsDir = path.join(dir, 'content/validators');
  mkdirSync(path.join(validatorsDir, 'fixtures'), { recursive: true });
  for (const name of [...gate, ...advisory]) {
    writeFileSync(
      path.join(validatorsDir, `${name}.sh`),
      '#!/bin/bash\n[ -e "$1/defect.txt" ] && exit 1\nexit 0\n',
    );
  }
  return validatorsDir;
}

function writeFixturePair(validatorsDir, name) {
  const red = path.join(validatorsDir, 'fixtures', name, 'red');
  const green = path.join(validatorsDir, 'fixtures', name, 'green');
  mkdirSync(red, { recursive: true });
  mkdirSync(green, { recursive: true });
  writeFileSync(path.join(red, 'defect.txt'), 'planted defect\n');
  writeFileSync(path.join(green, 'clean.txt'), 'clean\n');
}

function gitCommitAll(dir) {
  const git = (...args) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '--quiet');
  git('add', '-A');
  git(
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'user.name=fixture-test',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    'baseline',
  );
}

describe('check-validator-fixtures against the real tree', () => {
  it('passes clean: every gate validator has behaving red+green fixtures', () => {
    const { status, stdout } = runChecker([]);
    expect(status).toBe(0);
    expect(stdout).toContain('[OK] validate-file-size');
    expect(stdout).toContain('[OK] validate-circular-deps');
    expect(stdout.trim().endsWith('clean')).toBe(true);
  });
});

describe('check-validator-fixtures negative cases', () => {
  it('RED: a gate validator with no red fixture fails the check', () => {
    const dir = makeTempTree();
    scaffold(dir); // no fixtures at all for validate-alpha
    const { status, stderr } = runChecker(['--root', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain('missing its red fixture');
  });

  it('RED: a red fixture the validator passes (exit 0) fails the check', () => {
    const dir = makeTempTree();
    const validatorsDir = scaffold(dir);
    writeFixturePair(validatorsDir, 'validate-alpha');
    // Defuse the planted defect: the validator now exits 0 against red.
    rmSync(path.join(validatorsDir, 'fixtures/validate-alpha/red/defect.txt'));
    const { status, stderr } = runChecker(['--root', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain('red fixture did not fail');
  });

  it('RED: grandfather growth vs the committed file fails the check', () => {
    const dir = makeTempTree();
    const validatorsDir = scaffold(dir, {
      advisory: ['validate-beta', 'validate-gamma'],
    });
    writeFixturePair(validatorsDir, 'validate-alpha');
    const grandfatherPath = path.join(validatorsDir, 'fixtures/GRANDFATHERED.json');
    writeFileSync(grandfatherPath, JSON.stringify(['validate-beta']));
    gitCommitAll(dir);
    // Baseline: gamma is unfixtured and unlisted, so the check already fails —
    expect(runChecker(['--root', dir]).status).toBe(1);
    // — and GROWING the list to cover gamma must not be the way out.
    writeFileSync(grandfatherPath, JSON.stringify(['validate-beta', 'validate-gamma']));
    const { status, stderr } = runChecker(['--root', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain('GREW vs the committed file');
  });

  it('RED: a stale grandfather entry (fixtures now exist) fails the check', () => {
    const dir = makeTempTree();
    const validatorsDir = scaffold(dir, { advisory: ['validate-beta'] });
    writeFixturePair(validatorsDir, 'validate-alpha');
    writeFixturePair(validatorsDir, 'validate-beta');
    writeFileSync(
      path.join(validatorsDir, 'fixtures/GRANDFATHERED.json'),
      JSON.stringify(['validate-beta']),
    );
    const { status, stderr } = runChecker(['--root', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain('list may only shrink');
  });

  it('RED: a grandfathered GATE validator fails the check', () => {
    const dir = makeTempTree();
    const validatorsDir = scaffold(dir);
    writeFixturePair(validatorsDir, 'validate-alpha');
    writeFileSync(
      path.join(validatorsDir, 'fixtures/GRANDFATHERED.json'),
      JSON.stringify(['validate-alpha']),
    );
    const { status, stderr } = runChecker(['--root', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain('gate validators may never be grandfathered');
  });

  it('exits 2 on a self-error (unreadable config), never a false pass', () => {
    const dir = makeTempTree();
    const { status } = runChecker(['--root', dir]); // no conductor.config.json
    expect(status).toBe(2);
  });
});
