#!/usr/bin/env node
// Root `package.json`'s `bin` target (`npx shipwright` / `shipwright`, DEPLOYMENT.md §1).
// Plain JS on purpose: this repo has no compile step, so it can't `import` the
// TypeScript entry directly under plain node — it spawns `tsx` (already an
// `apps/server` devDependency, so `node_modules/.bin/tsx` exists after
// `pnpm install`, no new dependency needed) against `main.ts` instead.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsxBin = path.resolve(here, '..', '..', 'node_modules', '.bin', 'tsx');
const entry = path.resolve(here, 'main.ts');

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
