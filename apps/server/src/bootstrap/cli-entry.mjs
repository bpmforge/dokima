#!/usr/bin/env node
/**
 * Root `package.json`'s `bin` target (`npx dokima` / `dokima`,
 * DEPLOYMENT.md §1).
 *
 * Two runtimes, one entry point:
 *
 *  - INSTALLED (the packaged case): `apps/server/dist/main.js` exists — the
 *    bundle built by `apps/server/build.mjs` — so this imports it directly
 *    under plain `node`. No `tsx`, no TypeScript loader, nothing beyond the
 *    five external runtime deps.
 *  - SOURCE CHECKOUT with no build yet: fall back to spawning `tsx` against
 *    the TypeScript entry, which is what this file did unconditionally before
 *    W9-13. That kept `pnpm dev` and a fresh clone working without a build step.
 *
 * The fallback is why the packaged path had to be checked FIRST: a dev machine
 * has both, and silently preferring `tsx` there would mean the bundle was
 * never actually exercised by the person most likely to notice it was broken.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkNodeSupported, describeAbiMismatch } from './node-abi-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, '..', '..', 'dist', 'main.js');

/** `engines.node` is the value that is already authoritative and already ships. */
function supportedNodeRange() {
  try {
    const pkg = path.resolve(here, '..', '..', '..', '..', 'package.json');
    return JSON.parse(readFileSync(pkg, 'utf8')).engines?.node;
  } catch {
    return undefined;
  }
}

// W12-24: BEFORE anything is imported. The native module loads lazily deep
// inside a command, so catching the import is far too late — the first version
// of this guard did exactly that, passed its tests, and let the raw trace
// through anyway.
const unsupported = checkNodeSupported(supportedNodeRange());
if (unsupported) {
  console.error(unsupported);
  process.exit(1);
}

if (existsSync(bundle)) {
  try {
    await import(pathToFileURL(bundle).href);
  } catch (err) {
    // W12-24: a native ABI mismatch is the most likely first-run failure and
    // produced the least actionable message the product could emit. Anything
    // that is NOT that passes through untouched — dressing an unrelated crash
    // up as a Node-version problem would be worse than the raw trace.
    const refusal = describeAbiMismatch(err, { engines: supportedNodeRange() });
    if (!refusal) throw err;
    console.error(refusal);
    process.exit(1);
  }
} else {
  const tsxBin = path.resolve(here, '..', '..', 'node_modules', '.bin', 'tsx');
  const entry = path.resolve(here, 'main.ts');

  if (!existsSync(tsxBin)) {
    console.error(
      `dokima: no built bundle at ${bundle} and no tsx at ${tsxBin}.\n` +
        `Run \`pnpm build\` (packaged path) or \`pnpm install\` (source path).`,
    );
    process.exitCode = 1;
  } else {
    const child = spawn(tsxBin, [entry, ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    child.on('error', (err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
