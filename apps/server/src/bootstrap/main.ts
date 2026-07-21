#!/usr/bin/env node
/**
 * The packaged runtime's real entry point (DEPLOYMENT.md §1/§6). `cli-entry.mjs`
 * (the `bin` target in the root `package.json`) spawns `tsx` against this file —
 * there is no compile step in this repo yet, so a `.ts` bin can't run under plain
 * `node`/`npx` (HANDOFF: a real `npm publish` channel needs a build step that
 * emits this as plain JS; unverifiable here per C-1, no live registry/publish).
 */
import { runPackagedCli } from './cli.js';

async function main(): Promise<void> {
  const code = await runPackagedCli(process.argv.slice(2), {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    cwd: process.cwd(),
    env: process.env,
  });
  process.exitCode = code;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
