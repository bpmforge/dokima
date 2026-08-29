/**
 * Removes the temp projects the run made (W22-15).
 *
 * THE LEAK. Six suites created a project per test under `os.tmpdir()` and
 * never removed it. Measured against a full run: board 5, artifacts 5, fleet
 * 2, settings 1, tour-contract 2, a11y/settings 3, a11y/board 1,
 * a11y/keyboard-only 1. On this machine that had reached 26,760 `dokima-*`
 * directories and 968M, each holding a `.dokima/state.db`. Nothing ever
 * failed because of it, which is why it survived a green gate for months.
 *
 * WHY HERE AND NOT IN EACH SUITE. The obvious version — every spec removes
 * its own projects in `afterAll` — was written first, and the suite rejected
 * it: notifications.spec.ts and roster.spec.ts went red with
 * "getByRole('heading', { name: 'Fleet' }) resolved to 3 elements". A removed
 * project stays in the SHARED fleet registry, so later specs enumerate a card
 * whose directory has vanished, and an unavailable card renders its name as a
 * heading where an available one does not. A control run with the removal
 * stashed passed 76/76 against the same registry, which pins it on the
 * removal rather than on accumulation.
 *
 * W9-14 had already named the underlying question in `global-setup.ts`:
 * whether the Fleet view should hide or prune projects whose directory is
 * gone is a PRODUCT question with its own ticket. Deleting mid-run is that
 * question asked by accident. After the last spec, there is no one left to
 * observe the gap.
 *
 * BY NAME, NOT BY BOOKKEEPING. Every temp project now comes from
 * `freshProjectPath`, so they all match `dokima-<label>-e2e-<uuid>` — which
 * is exactly the shape A1 is written against. Matching that is simpler than
 * threading a registry of created paths across eight spec files and two
 * processes, and it cannot go stale when a new suite is added. The one
 * `dokima-*-e2e-*` entry that is NOT a temp project is the fixed shared HOME
 * from `env-paths.ts`, excluded by exact path: it is a fixture, it does not
 * accumulate, and removing it would break every spec.
 *
 * IT DOES NOT SWALLOW. `removeTempProject` already retries a lost race
 * (W22-12); anything still throwing after that is a real failure, and a
 * teardown that hid it would hide the leak it exists to prevent.
 */
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOME } from './env-paths.js';
import { removeTempProject } from './temp-project.js';

/** `dokima-<label>-e2e-<uuid>` — what `freshProjectPath` produces, and what A1 names. */
const TEMP_PROJECT = /^dokima-.+-e2e-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function globalTeardown(): Promise<void> {
  const tmp = os.tmpdir();
  const entries = await readdir(tmp);
  const made = entries
    .filter((name) => TEMP_PROJECT.test(name))
    .map((name) => path.join(tmp, name))
    .filter((dir) => dir !== HOME);

  for (const dir of made) await removeTempProject(dir);
  console.log(`[e2e] removed ${made.length} temp project(s) left by this run`);
}
