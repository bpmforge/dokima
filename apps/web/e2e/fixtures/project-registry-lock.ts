/**
 * Cross-process mutex for `POST /api/v1/projects`.
 *
 * `apps/server/src/api/projects.ts`'s Fleet registry (`fleet.json`) is a
 * plain read-modify-write JSON file with no locking (out of this ticket's
 * write_scope to fix — not `server.ts`/`server/**`): two concurrent
 * `POST /api/v1/projects` calls from different Playwright worker
 * *processes* can each load the registry before either has saved, then
 * each save clobbers the other's — one registration silently vanishes even
 * though its own request returned 201. Retrying the lost request doesn't
 * help (it just adds more concurrent writers, worsening the odds); the
 * actual fix is serializing every create across every e2e worker process,
 * which is what this lock does, via `fs.mkdir`'s atomicity (POSIX
 * `mkdir` either creates the directory or fails with `EEXIST` — no
 * separate check-then-act window) at a fixed path every worker agrees on.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_DIR = path.join(os.tmpdir(), 'dokima-web-e2e-project-registry.lock');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(): Promise<void> {
  for (;;) {
    try {
      await fs.mkdir(LOCK_DIR);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      await sleep(50);
    }
  }
}

async function release(): Promise<void> {
  await fs.rm(LOCK_DIR, { recursive: true, force: true });
}

export async function withProjectRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    await release();
  }
}
