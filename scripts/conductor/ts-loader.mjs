// conductor/ts-loader.mjs — P6-09: make lazy workspace-TS imports work under
// PLAIN node, not only vitest.
//
// The first live run of the product loop halted `assembler-unavailable`:
// gate.ts imports `./assembly.js` (a runtime .js specifier), which node's
// type stripping does not resolve to .ts — the W9-12 constraint — while
// vitest transforms it, so every test was green and the CLI was broken.
// Registering the workspace's own tsx loader resolves .js->.ts process-wide.
// Best-effort by design: on a vendored install with no tsx, callers keep the
// loud degrade they already have.

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let registered = false;

export async function ensureTsLoader() {
  if (registered) return true;
  const candidates = [
    resolve(ROOT, 'node_modules/tsx/dist/esm/api/index.mjs'),
    resolve(ROOT, 'apps/server/node_modules/tsx/dist/esm/api/index.mjs'),
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const { register } = await import(c);
      register();
      registered = true;
      return true;
    } catch {
      /* try the next candidate; fall through to false */
    }
  }
  return false;
}
