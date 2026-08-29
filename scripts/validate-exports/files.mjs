// Chapter of `validate-exports.mjs` (W22-02 split, W10-46 pattern): which
// files are scanned, and which of them can count as EVIDENCE of use.
//
// The two classification rules here carry most of the validator's honesty. A
// test file cannot establish that production code is used, and a barrel
// re-export is plumbing rather than a consumer — get either wrong and the
// whole report inverts.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// TWO levels, not one: this chapter lives in `scripts/validate-exports/`,
// while the barrel that used to hold it sits in `scripts/`. The split moved
// the file and therefore moved this — it failed immediately and loudly
// (ENOENT on `scripts/packages`), which is the good case for a constant like
// this one. A path constant that silently resolves somewhere plausible is how
// a scan quietly covers nothing.
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs'];
export const SCAN_ROOTS = ['apps', 'packages', 'scripts'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

/** A file whose only purpose is to exercise code cannot establish that the code is used. */
export function isTestFile(file) {
  return /\.(test|spec)\.(ts|tsx|mts|mjs)$/.test(file) || /(^|\/)e2e\//.test(file);
}

/** A barrel re-export is plumbing, never evidence of a consumer. */
export function isBarrel(file) {
  return /(^|\/)index\.ts$/.test(file);
}

export function walkSourceFiles(root, acc = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkSourceFiles(full, acc);
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry))) acc.push(full);
  }
  return acc;
}

/**
 * Test SUPPORT in a production-shaped file. Recorded fixtures and fake
 * adapters are exported for tests and called by nothing else BY DESIGN (law
 * 9a is why they exist), so reporting them reports the testing discipline as
 * a defect — 30 of the first 90 findings. Matched on the path, not the symbol
 * name: the file's location is the author's own statement of intent.
 */
export function isTestSupportFile(file) {
  const base = path.basename(file.replace(/\\/g, '/'));
  // Named on the file (`copilot-fixtures.ts`), or under a `fixtures/` dir.
  return (
    /(^|[-.])(fixtures?|test-helpers?|test-support)\.[cm]?tsx?$/.test(base) ||
    /(^|\/)(fixtures?|__fixtures__)\//.test(file.replace(/\\/g, '/'))
  );
}
