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
import { reportFatal } from './fatal.js';

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
  // W22-01: `console.error(err)` printed a stack for every failure that no
  // inner handler recognised. See fatal.ts for why the default is now a
  // refusal. Exit stays 1 — 2 is this CLI's "refused by a gate" code
  // (run-build.ts), and an unrecognised failure is not that.
  reportFatal(err, (line) => console.error(line));
  process.exitCode = 1;
});
