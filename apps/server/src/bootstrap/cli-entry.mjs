#!/usr/bin/env node
/**
 * Root `package.json`'s `bin` target (`npx shipwright` / `shipwright`,
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
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, '..', '..', 'dist', 'main.js');

if (existsSync(bundle)) {
  await import(pathToFileURL(bundle).href);
} else {
  const tsxBin = path.resolve(here, '..', '..', 'node_modules', '.bin', 'tsx');
  const entry = path.resolve(here, 'main.ts');

  if (!existsSync(tsxBin)) {
    console.error(
      `shipwright: no built bundle at ${bundle} and no tsx at ${tsxBin}.\n` +
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
