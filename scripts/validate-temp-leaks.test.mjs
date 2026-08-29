/**
 * validate-temp-leaks.test.mjs — proven by a PLANTED leak (W22-18 A3).
 *
 * A validator written against an already-clean tree is a validator nobody has
 * ever seen say no, which is the SAST-runner and capture-tour failure this
 * check exists to avoid repeating. Every case here builds its own temp root
 * and puts a real directory in it, so the check is observed failing before it
 * is trusted passing.
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_MINUTES,
  FIXTURE_DIRS,
  leakedTempDirs,
} from './validate-temp-leaks.mjs';

let root;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** A temp root this test owns — never the machine's real tmpdir. */
function freshRoot() {
  root = mkdtempSync(path.join(os.tmpdir(), 'w2218-validator-'));
  return root;
}

/** Plants a directory and backdates it by `ageMinutes`. */
function plant(name, ageMinutes = 0) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const when = new Date(Date.now() - ageMinutes * 60_000);
  utimesSync(dir, when, when);
  return dir;
}

describe('validate-temp-leaks (W22-18)', () => {
  it('RED FIXTURE: a planted leak is reported', () => {
    freshRoot();
    plant('dokima-board-e2e-abc');
    expect(leakedTempDirs(root)).toEqual(['dokima-board-e2e-abc']);
  });

  it('a clean root reports nothing — and that is only meaningful next to the case above', () => {
    freshRoot();
    expect(leakedTempDirs(root)).toEqual([]);
  });

  it('only OUR prefix counts — another tool\'s temp directory is not our leak', () => {
    freshRoot();
    plant('something-else-123');
    plant('dokima-board-e2e-abc');
    expect(leakedTempDirs(root)).toEqual(['dokima-board-e2e-abc']);
  });

  it('history outside the window is not reported — the check asks about THIS run', () => {
    freshRoot();
    plant('dokima-old-e2e-abc', DEFAULT_WINDOW_MINUTES + 5);
    expect(leakedTempDirs(root)).toEqual([]);
    // …and the same directory IS reported by a window wide enough to include it.
    expect(leakedTempDirs(root, DEFAULT_WINDOW_MINUTES + 10)).toEqual(['dokima-old-e2e-abc']);
  });

  it('the shared e2e HOME is a fixture, not a leak', () => {
    freshRoot();
    for (const name of FIXTURE_DIRS) plant(name);
    expect(leakedTempDirs(root)).toEqual([]);
  });

  it('a file is not a directory, and a missing root is not a leak', () => {
    freshRoot();
    writeFileSync(path.join(root, 'dokima-not-a-dir'), 'x');
    expect(leakedTempDirs(root)).toEqual([]);
    expect(leakedTempDirs(path.join(root, 'does-not-exist'))).toEqual([]);
  });
});
