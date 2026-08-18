#!/usr/bin/env node
/**
 * scripts/check-node.mjs — `pretest`, so the suite refuses the wrong Node
 * instead of emitting a raw ABI error (W13-08).
 *
 * A stop hook reported "tests failed" when they had not: the full gate was
 * green on Node 22, and the hook's own shell had fnm's default (v24) — or, with
 * no fnm at all, Homebrew's v26. `better-sqlite3`'s binary is built for 22, so
 * the suite dies with `NODE_MODULE_VERSION 127 ... requires 147`, a message
 * that names neither this product nor the fix. CLAUDE.md law 3 warns about
 * exactly this and says it "looks exactly like real breakage" — which is what
 * it did.
 *
 * W12-24 already wrote the check and the message for the CLI bootstrap path.
 * Tests, CI and hooks never touch that path, so the one place the trap is
 * actually sprung had no guard. This reuses that function rather than adding a
 * second copy — duplicated checks are the defect class this board keeps
 * finding.
 *
 * REFUSES rather than re-execing under a different Node: silently switching
 * would hide which runtime the suite ran on, and a test suite that lies about
 * its own runtime is worse than one that stops.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNodeSupported } from '../apps/server/src/bootstrap/node-abi-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readEngines(pkgPath = path.join(root, 'package.json')) {
  return JSON.parse(readFileSync(pkgPath, 'utf8')).engines?.node;
}

function main() {
  const problem = checkNodeSupported(readEngines());
  if (problem === null) return;
  console.error(problem);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
