#!/usr/bin/env node
/**
 * validate-volatile-paths.mjs — no product code writes user data to /tmp
 * (W13-64).
 *
 * THE LESSON THIS ENCODES, learned the expensive way: the setup wizard
 * hardcoded the guided sample into `/tmp/dokima-sample-<ts>`. /tmp is
 * volatile (macOS clears it on reboot) and SHARED — and the e2e suite's
 * cleanup glob-deleted every such folder on the machine, which destroyed a
 * real walkthrough's first project during an ordinary test run. Data loss,
 * observed, from one string literal.
 *
 * The rule: a `/tmp/` literal may not appear in shipped product source
 * (apps/{web,server}/src and every package src dir). Tests, scripts and fixtures may
 * use temp dirs freely — through os.tmpdir()/mkdtemp, which is also what
 * product code should use for genuinely temporary files. Comments are
 * stripped first, so the lesson may still be WRITTEN DOWN next to the code
 * it protects.
 *
 * Contract: validate-exports.mjs precedent — pure functions for tests,
 * main() prints human lines + one JSON line, exit 0/1. No baseline file:
 * the count is zero at introduction and must stay zero.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './validate-exports.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['apps/web/src', 'apps/server/src'];

/** Package sources too, except test helpers whose whole job is temp fixtures. */
function isProductFile(rel) {
  return (
    /\.(ts|tsx)$/.test(rel) &&
    !/\.(test|spec)\./.test(rel) &&
    !/test-helpers?/.test(rel) &&
    !/fixtures?\//.test(rel)
  );
}

export function findVolatilePathLiterals(text) {
  const stripped = stripComments(text);
  const hits = [];
  for (const match of stripped.matchAll(/['"`]\/(?:private\/)?tmp\//g)) {
    hits.push(match[0]);
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  const packagesDir = path.join(root, 'packages');
  const roots = [...SCAN_ROOTS.map((r) => path.join(root, r))];
  for (const pkg of readdirSync(packagesDir)) {
    const src = path.join(packagesDir, pkg, 'src');
    try {
      if (statSync(src).isDirectory()) roots.push(src);
    } catch {
      /* no src dir */
    }
  }
  for (const scanRoot of roots) {
    for (const file of walk(scanRoot)) {
      const rel = path.relative(root, file);
      if (!isProductFile(rel)) continue;
      const hits = findVolatilePathLiterals(readFileSync(file, 'utf8'));
      for (const hit of hits) violations.push({ file: rel, literal: hit });
    }
  }
  return violations;
}

function main() {
  const violations = scanRepo();
  for (const v of violations) {
    console.log(`  [volatile-path] ${v.literal}… — ${v.file}`);
  }
  const exit = violations.length > 0 ? 1 : 0;
  console.log(
    exit === 0
      ? 'OK: volatile-paths — no /tmp literals in product source'
      : `FAIL: volatile-paths — ${violations.length} /tmp literal(s) in product source. User data in /tmp is erased by the OS and was once erased by our own test suite (W13-64). Use the workspace root or os.tmpdir().`,
  );
  console.log(JSON.stringify({ validator: 'validate-volatile-paths', violations: violations.length, exit }));
  process.exit(exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
