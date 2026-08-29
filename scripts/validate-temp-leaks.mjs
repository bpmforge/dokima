#!/usr/bin/env node
/**
 * validate-temp-leaks.mjs — a test run must not leave temp directories behind
 * (W22-18).
 *
 * WHY THIS EXISTS, and it is not tidiness. Three consecutive tickets found
 * temp leaks BY HAND: W22-12 (an e2e teardown race), W22-15 (20 directories
 * per e2e run, from eight suites), W22-16 (270 per unit run, from a cleanup
 * handler attached to an event the process never reaches). Each was found
 * because somebody happened to look at a tmpdir. None was found by a failure.
 * By the time anyone looked there were 26,760 directories and 968M of them,
 * accumulated under a permanently green gate.
 *
 * A leak cannot fail a test — that is the whole difficulty. It costs nothing
 * a test can observe, so it survives every gate indefinitely, and the fixes
 * above will rot back the moment this wave of attention passes. That is the
 * L-47 shape the board keeps re-learning: a real problem with no mechanical
 * check decays into a problem nobody can see.
 *
 * MTIME, NOT TOTAL COUNT. The tmpdir on a developer's machine holds months of
 * history — 26,829 directories at the time this was written, almost all from
 * before those fixes — so an absolute count would fail forever for reasons no
 * commit can address. This asks a narrower and answerable question: did
 * anything appear in the last `--window` minutes? Law 3 runs `pnpm test` and
 * the e2e suite immediately before `pnpm validate`, so a leak from this gate's
 * own run is inside the window and history is not.
 *
 * IT CAN BE WRONG, IN EXACTLY ONE WAY, and the failure says so: a SECOND
 * Dokima run on the same machine (the conductor is shared across projects)
 * writes to the same tmpdir with the same prefixes, and its directories are
 * indistinguishable from a leak here. That is rare, obvious from the message,
 * and cheap to dismiss — a worse trade than a check that has never once been
 * observed to say no.
 *
 * IT REPORTS AND NEVER REMOVES, deliberately. W13-64 is the reason: an e2e
 * cleanup glob-deleted every `dokima-*` folder on the machine and destroyed a
 * real walkthrough's first project during an ordinary test run — observed data
 * loss from one string literal. A validator that swept what it found would be
 * that incident with a wider blast radius, so this one only ever prints paths.
 *
 * Contract: validate-volatile-paths.mjs precedent — pure functions for tests,
 * main() prints human lines + one JSON line, exit 0/1.
 */
import { readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Everything this repo's tests name their temp directories with. */
export const TEMP_PREFIX = 'dokima-';

/**
 * Long enough to cover ONE gate, not a working session.
 *
 * Law 3 runs test (~30s) then e2e (~45s) then this, so under three minutes
 * separates a leak from its report; ten leaves generous margin. Measured
 * before it was chosen, on a machine mid-cleanup: a 60-minute window flagged
 * 1,501 directories and a 20-minute one 312, almost all of them real leaks
 * from runs earlier the same hour — true, and useless as a gate, because no
 * commit can address them and a check that fails for unfixable reasons is one
 * people learn to skip. Ten minutes asks only about the run that just
 * happened.
 */
export const DEFAULT_WINDOW_MINUTES = 10;

/**
 * The one fixed-name directory that is a FIXTURE, not a leak.
 *
 * `apps/web/e2e/env-paths.ts` uses a single shared HOME for the whole e2e
 * suite, cleared at global setup and reused. It matches the prefix by
 * coincidence of naming, does not accumulate, and removing it would break
 * every spec — the same exclusion `global-teardown.ts` makes.
 */
export const FIXTURE_DIRS = ['dokima-web-e2e-home'];

/**
 * Temp directories that appeared inside the window.
 *
 * Split out from `main` so a test can point it at a directory it controls and
 * plant a real leak, rather than asserting that a clean machine is clean —
 * which is how a validator ends up never having been seen to fail.
 */
export function leakedTempDirs(tmpRoot, windowMinutes = DEFAULT_WINDOW_MINUTES, now = Date.now()) {
  const cutoff = now - windowMinutes * 60_000;
  let entries;
  try {
    entries = readdirSync(tmpRoot);
  } catch {
    // No tmpdir to read is not a leak.
    return [];
  }
  const leaked = [];
  for (const name of entries) {
    if (!name.startsWith(TEMP_PREFIX) || FIXTURE_DIRS.includes(name)) continue;
    const full = path.join(tmpRoot, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      // Vanished between readdir and stat — it is gone, which is the goal.
      continue;
    }
    if (!stat.isDirectory() || stat.mtimeMs < cutoff) continue;
    leaked.push(name);
  }
  return leaked.sort();
}

function main() {
  const windowArg = process.argv.indexOf('--window');
  const windowMinutes =
    windowArg >= 0 ? Number(process.argv[windowArg + 1]) : DEFAULT_WINDOW_MINUTES;
  const tmpRoot = os.tmpdir();
  const leaked = leakedTempDirs(tmpRoot, windowMinutes);
  for (const name of leaked.slice(0, 10)) {
    console.log(`  [temp-leak] ${path.join(tmpRoot, name)}`);
  }
  if (leaked.length > 10) {
    console.log(`  … and ${leaked.length - 10} more`);
  }
  const exit = leaked.length > 0 ? 1 : 0;
  console.log(
    exit === 0
      ? `OK: temp-leaks — nothing left in ${tmpRoot} in the last ${windowMinutes}m`
      : `FAIL: temp-leaks — ${leaked.length} temp director(ies) left behind in the last ` +
          `${windowMinutes}m. A test that makes a temp directory must remove it; see ` +
          `apps/web/e2e/global-teardown.ts and apps/server/vitest.setup.ts for the two shapes. ` +
          `(If another Dokima run is active on this machine, these may be its — the tmpdir is shared.)`,
  );
  console.log(JSON.stringify({ validator: 'validate-temp-leaks', violations: leaked.length, exit }));
  process.exit(exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
