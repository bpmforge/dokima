/**
 * W23-26. Every TypeScript file the test run EXECUTES must be typechecked.
 *
 * FOUND BY A DEAD HELPER. apps/server/vitest.setup.ts — the file that pins
 * DOKIMA_HOME, the credential store and the model seam for the whole server
 * suite — called `w22_16_write`, a function that exists nowhere in this repo.
 * It sat there because every package tsconfig said `"include": ["src"]`, so
 * tsc had never read the file. The one place a ReferenceError would
 * mis-configure every test in a package was the one place nothing checked.
 *
 * A CONFIG FILE THAT DOES NOT COMPILE IS NOT A LESSER PROBLEM than a source
 * file that does not compile: vitest.config.ts decides which tests run, and
 * playwright.config.ts decides what the e2e gate even points at.
 *
 * This asserts COVERAGE, not correctness — tsc does the checking. Without it
 * the fix lasts exactly until someone adds the next root-level config file.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that own a tsconfig, plus the repo root's own. */
function configuredDirs() {
  const dirs = ['apps/server', 'apps/web'];
  for (const pkg of readdirSync(path.join(ROOT, 'packages'))) {
    dirs.push(`packages/${pkg}`);
  }
  return dirs.filter((d) => existsSync(path.join(ROOT, d, 'tsconfig.json')));
}

const includeOf = (relConfig) =>
  JSON.parse(readFileSync(path.join(ROOT, relConfig), 'utf8')).include ?? [];

describe('every executed TypeScript file is inside some tsconfig (W23-26)', () => {
  it.each(configuredDirs())(
    '%s: no root-level .ts file is outside its tsconfig include',
    (dir) => {
      const include = includeOf(`${dir}/tsconfig.json`);
      const rootTs = readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.ts'));
      const uncovered = rootTs.filter((f) => !include.includes(f));
      expect(uncovered).toEqual([]);
    },
  );

  it('the repo root has its own config, and it covers both root files', () => {
    const include = includeOf('tsconfig.root.json');
    const rootTs = readdirSync(ROOT).filter((f) => f.endsWith('.ts'));
    expect(rootTs.length).toBeGreaterThan(0);
    for (const file of rootTs) expect(include).toContain(file);
  });

  it('`pnpm typecheck` actually runs the root config — a config nobody runs checks nothing', () => {
    const scripts = JSON.parse(
      readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    ).scripts;
    expect(scripts.typecheck).toContain('tsconfig.root.json');
  });
});
