import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WatchdogBreach } from './watchdog.js';
import { createWatchdogChildProcessSpawn } from './watchdog-process.js';

/** True while `pid` (or its process group leader) is still alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function readPidFile(pidFile: string): Promise<number | undefined> {
  const raw = await fs.readFile(pidFile, 'utf8').catch(() => '');
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

describe('createWatchdogChildProcessSpawn', () => {
  let cwd: string | undefined;

  afterEach(async () => {
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('terminates a hung process once maxSessionSeconds elapses, well under a second', async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-watchdog-proc-'));
    const breaches: WatchdogBreach[] = [];
    const spawn = createWatchdogChildProcessSpawn({
      command: 'bash',
      args: ['-c', 'sleep 30'],
      maxSessionSeconds: 0.05,
      heartbeatStallSeconds: 60,
      pollIntervalMs: 10,
      forceKillGraceMs: 100,
      onBreach: (breach) => breaches.push(breach),
    });

    const start = Date.now();
    const result = await spawn({ prompt: 'go', cwd });
    const elapsed = Date.now() - start;

    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.reason).toBe('max_session_seconds');
    expect(elapsed).toBeLessThan(1_000);
    expect(result.exitCode).not.toBe(0);
  });

  it('terminates a process that stops heartbeating even though it never hits the wall clock', async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-watchdog-proc-'));
    const breaches: WatchdogBreach[] = [];
    // Prints once immediately, then goes silent for far longer than the stall threshold.
    const spawn = createWatchdogChildProcessSpawn({
      command: 'bash',
      args: ['-c', 'echo alive; sleep 30'],
      maxSessionSeconds: 60,
      // Margins widened from 0.05s/10ms/100ms: those were tight enough to flake
      // under machine load (the poll couldn't reliably observe the stall inside
      // the window). The child stays silent for 30s — far past any threshold —
      // so a generous stall/poll window still proves the heartbeat-stall kill
      // deterministically without racing the scheduler under load.
      heartbeatStallSeconds: 0.3,
      pollIntervalMs: 25,
      forceKillGraceMs: 300,
      onBreach: (breach) => breaches.push(breach),
    });

    const result = await spawn({ prompt: 'go', cwd });

    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.reason).toBe('heartbeat_stall');
    expect(result.stdout).toContain('alive');
  });

  it('kills the whole session tree — a grandchild forked by the killed process dies too', async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-watchdog-proc-'));
    const pidFile = path.join(cwd, 'grandchild.pid');
    // Forks `sleep 30` directly in this shell (so `$!` is its real pid, not a
    // subshell's), records the pid, then `wait`s — the watchdog must kill the
    // whole group, not just the bash process that's blocked on `wait`.
    const script = `sleep 30 & echo $! > "${pidFile}"; wait`;
    const spawn = createWatchdogChildProcessSpawn({
      command: 'bash',
      args: ['-c', script],
      maxSessionSeconds: 0.05,
      heartbeatStallSeconds: 60,
      pollIntervalMs: 10,
      forceKillGraceMs: 100,
      onBreach: () => {},
    });

    const spawned = spawn({ prompt: 'go', cwd });
    await waitUntil(async () => (await readPidFile(pidFile)) !== undefined);
    const grandchildPid = await readPidFile(pidFile);
    expect(grandchildPid).toBeDefined();
    expect(isAlive(grandchildPid as number)).toBe(true);

    await spawned;
    await waitUntil(() => !isAlive(grandchildPid as number), 2_000);
    expect(isAlive(grandchildPid as number)).toBe(false);
  });

  it('still kills the tree and resolves when onBreach throws synchronously', async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-watchdog-proc-'));
    const spawn = createWatchdogChildProcessSpawn({
      command: 'bash',
      args: ['-c', 'sleep 30'],
      maxSessionSeconds: 0.05,
      heartbeatStallSeconds: 60,
      pollIntervalMs: 10,
      forceKillGraceMs: 100,
      onBreach: () => {
        throw new Error('dead-letter bookkeeping failed (e.g. SQLITE_BUSY)');
      },
    });

    const start = Date.now();
    const result = await spawn({ prompt: 'go', cwd });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1_000);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('onBreach handler threw');
  });

  it('escalates to SIGKILL when the tree ignores SIGTERM', async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-watchdog-proc-'));
    const breaches: WatchdogBreach[] = [];
    const spawn = createWatchdogChildProcessSpawn({
      command: 'bash',
      args: ['-c', "trap '' TERM; sleep 30"],
      maxSessionSeconds: 0.05,
      heartbeatStallSeconds: 60,
      pollIntervalMs: 10,
      forceKillGraceMs: 100,
      onBreach: (breach) => breaches.push(breach),
    });

    const start = Date.now();
    await spawn({ prompt: 'go', cwd });
    const elapsed = Date.now() - start;

    expect(breaches).toHaveLength(1);
    // Should resolve once SIGKILL lands: roughly maxSessionSeconds + forceKillGraceMs, not 30s.
    expect(elapsed).toBeLessThan(2_000);
  });
});

/**
 * W13-45. Ported from `packages/loop/src/session.test.ts` when
 * `createChildProcessSpawn` was removed as superseded.
 *
 * These are the only tests of a real security control — an untrusted agent
 * session must not inherit the parent's environment (SC-03/SC-07) — and
 * W13-47 had just moved every external agent onto THIS spawn, which had no
 * env coverage whatsoever. Deleting the old home without moving them would
 * have left the control asserted nowhere while the code that needs it was
 * newly in charge.
 */
describe('the watched spawn does not leak the parent env (SC-03/SC-07)', () => {
  const NEVER_BREACHES = { maxSessionSeconds: 600, heartbeatStallSeconds: 600 };

  it('defaults to PATH only', async () => {
    process.env.DOKIMA_TEST_PLANTED_SECRET = 'planted-value-must-not-leak';
    try {
      const spawn = createWatchdogChildProcessSpawn({
        command: process.execPath,
        args: ['-e'],
        ...NEVER_BREACHES,
        onBreach: () => undefined,
      });
      const result = await spawn({
        prompt: 'console.log(JSON.stringify(process.env));',
        cwd: process.cwd(),
      });

      const childEnv = JSON.parse(result.stdout) as Record<string, string | undefined>;
      expect(childEnv.DOKIMA_TEST_PLANTED_SECRET).toBeUndefined();
      expect(childEnv.PATH).toBe(process.env.PATH);
      // Only the OS/runtime may inject entries (e.g. macOS's
      // __CF_USER_TEXT_ENCODING); nothing else from the parent may pass
      // through implicitly.
      const unexpected = Object.keys(childEnv).filter(
        (key) => key !== 'PATH' && !key.startsWith('__CF_'),
      );
      expect(unexpected).toEqual([]);
    } finally {
      delete process.env.DOKIMA_TEST_PLANTED_SECRET;
    }
  }, 20_000);

  it('honors an explicitly passed env instead of the minimal default', async () => {
    const spawn = createWatchdogChildProcessSpawn({
      command: process.execPath,
      args: ['-e'],
      env: { PATH: process.env.PATH, DOKIMA_TEST_EXPLICIT: 'yes' },
      ...NEVER_BREACHES,
      onBreach: () => undefined,
    });
    const result = await spawn({
      prompt: 'console.log(process.env.DOKIMA_TEST_EXPLICIT ?? "missing");',
      cwd: process.cwd(),
    });

    expect(result.stdout).toContain('yes');
  }, 20_000);
});
