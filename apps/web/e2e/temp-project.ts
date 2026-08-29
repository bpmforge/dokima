/**
 * temp-project.ts — one place to make and remove an e2e project (W22-12).
 *
 * THE RACE. `pnpm --filter @dokima/web e2e` failed on an unchanged tree with
 * "ENOTEMPTY: directory not empty, rmdir .../dokima-notifications-e2e-<uuid>/
 * .dokima": the spec removed its temp project while the server was still
 * reading it for the Fleet cards, and a `-wal`/`-shm` sibling appeared between
 * `fs.rm`'s walk and its final `rmdir`. W21-77 fixed the server half — a
 * project that vanishes mid-read is now absent rather than an error — and left
 * this half, which is the removal itself.
 *
 * THE FIX WAS ALREADY IN THE REPO, APPLIED ONCE. `team.spec.ts` has removed
 * with `maxRetries: 8, retryDelay: 60` for some time. Nothing carried it to
 * the other five specs, because there was nowhere for it to live: the removal
 * was written out longhand at ten call sites across four files, so fixing it
 * meant fixing it ten times. That is the duplication this module exists to
 * end — not tidiness, but the fact that a fix could not spread.
 *
 * IT STILL FAILS ON A REAL FAILURE. `force` swallows "already gone", which is
 * correct, and the retries cover a transient loser of the race — but a
 * directory that genuinely cannot be removed still throws after the last
 * attempt. A teardown that swallowed everything would hide the leak it is
 * meant to prevent, and there is a fixture for exactly that.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** How many times a removal may lose the race before it is a real failure. */
export const REMOVE_MAX_RETRIES = 8;
/** Milliseconds between attempts — long enough for a checkpoint, short enough to stay a test. */
export const REMOVE_RETRY_DELAY_MS = 60;

export interface TempProject {
  /** Absolute path the project is created at. */
  readonly dir: string;
  /** Human-readable name the UI is driven with. */
  readonly name: string;
}

/**
 * A unique temp project path for one spec.
 *
 * `label` keeps the old per-spec prefixes ("notifications", "trace") so a
 * leftover directory still names the suite that made it — the thing you want
 * when you find one on disk a week later.
 */
export function freshProjectPath(label: string): TempProject {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `dokima-${label}-e2e-${id}`),
    name: `${label[0]?.toUpperCase()}${label.slice(1)} E2E ${id}`,
  };
}

/**
 * Removes a temp project, retrying a lost race rather than failing the suite.
 *
 * Not wrapped in try/catch on purpose: see the module header. A removal that
 * still fails after every retry is a real failure and must surface.
 */
export async function removeTempProject(dir: string): Promise<void> {
  await fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_MAX_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  });
}
