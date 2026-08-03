#!/usr/bin/env node
/**
 * The packaged runtime's real entry point (DEPLOYMENT.md §1/§6). `cli-entry.mjs`
 * (the `bin` target in the root `package.json`) prefers the built bundle at
 * `apps/server/dist/main.js` and only falls back to spawning `tsx` against this
 * file in a source checkout with no build yet.
 *
 * The HANDOFF that used to sit here — "a real publish channel needs a build step
 * that emits this as plain JS; unverifiable here, no live registry" — is
 * discharged: `apps/server/build.mjs` (W9-13) emits that bundle, and W10-43
 * verified the whole path by installing a real tarball into a clean project and
 * driving the installed binary.
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
