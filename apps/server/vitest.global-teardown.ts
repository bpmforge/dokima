/**
 * Sweeps the suite home a terminated worker leaves behind (W23-19).
 *
 * THE LEAK THAT NO PER-FILE TEARDOWN CAN CLOSE. vitest.setup.ts makes one
 * `dokima-suite-home-*` per test file and removes it in `afterAll`. That
 * teardown demonstrably runs — 129 setups against 129 teardowns (W22-21) — and
 * roughly one full run in two on this machine still left exactly one home.
 * The W23-19 instrumentation named the shape: a survivor with an EMPTY home
 * and a marker naming no test file, i.e. the setup ran and the tests never
 * started. The forks pool terminates a worker whose RPC times out under load
 * (`[vitest-worker]: Timeout calling "onTaskUpdate"`, seen twice with every
 * test passing), and a terminated worker reaches no `afterAll`. Nothing IN the
 * worker can clean up after the worker is gone.
 *
 * SO THE RUN DOES IT. This runs in the main process once every file has
 * finished. It is NOT after the pool closes — `Vitest.close()` runs global
 * teardown first, then closes the pool — so idle workers may still be alive
 * here. That is why the rule is "dead pid", not "everything": a worker that
 * finished its file has already removed its home, a worker terminated mid-file
 * is dead, and a home whose pid is alive belongs to a run still going
 * (this one, or a concurrent one — the tmpdir is shared, and W23-19 counted
 * seven LIVE homes from a parallel suite once). `.created-by` exists so that
 * this discrimination is possible at all.
 *
 * IT SAYS WHAT IT FOUND. W23-19's first criterion is the leak explained "with
 * instrumentation output rather than a theory", and a sweep that removed the
 * evidence silently would make the next sighting anonymous again. Every home
 * removed here is printed with its marker, so the run log names the worker,
 * the file (or its absence) and the time — at the moment it happens, not
 * whenever someone next looks in tmpdir.
 *
 * IT DOES NOT SWALLOW. A home that will not delete after the same retries the
 * per-file teardown uses is a real failure, and validate-temp-leaks would fail
 * the gate on it anyway; better to fail here with the path in hand.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIX = 'dokima-suite-home-';

interface CreatedBy {
  pid?: number;
  worker?: string | null;
  testFile?: string | null;
  createdAt?: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and is someone else's; only ESRCH means gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readMarker(home: string): CreatedBy | null {
  const marker = path.join(home, '.created-by');
  if (!existsSync(marker)) return null;
  try {
    return JSON.parse(readFileSync(marker, 'utf8')) as CreatedBy;
  } catch {
    return null;
  }
}

/** Removes every suite home whose creating worker is dead; returns what it removed. */
export function sweepOrphanedSuiteHomes(tmpdir = os.tmpdir()): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(tmpdir)) {
    if (!name.startsWith(PREFIX)) continue;
    const home = path.join(tmpdir, name);
    const by = readMarker(home);
    // No marker: not one of ours to judge (pre-W23-19 residue, or a home
    // mid-creation whose marker is not written yet). Left in place — but
    // NAMED (W23-29): the one sighting after W23-19 was exactly this shape,
    // global.db and nothing else, and it was found by hand. The run log is
    // where the next one should appear.
    if (!by || typeof by.pid !== 'number') {
      let files: string[] = [];
      try {
        files = readdirSync(home);
      } catch {
        // Gone between readdir and here — nothing to report.
        continue;
      }
      console.error(
        `[global-teardown] W23-29: suite home with NO marker — not removed, cannot ` +
          `tell a leak from a live run: ${home} (files: ${files.join(', ') || 'none'})`,
      );
      continue;
    }
    if (isAlive(by.pid)) continue;
    console.error(
      `[global-teardown] W23-19: removing suite home its worker never cleaned up — ` +
        `pid ${by.pid} (dead), worker ${by.worker ?? '?'}, ` +
        `file ${by.testFile ?? 'NONE (setup ran, tests never started)'}, created ${by.createdAt ?? '?'}: ${home}`,
    );
    rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 });
    removed.push(home);
  }
  return removed;
}

export function teardown(): void {
  sweepOrphanedSuiteHomes();
}
