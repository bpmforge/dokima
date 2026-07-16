/**
 * Real session-tree spawner enforcing `watchdog.ts`'s limits (BLUEPRINT
 * §3.6/§7.1, FR-H2). A `node:child_process` implementation that runs the
 * child in its own process group (mirroring `@shipwright/validators`'
 * `run.ts` hang-kill pattern) and polls `checkWatchdogBreach` against
 * wall-clock elapsed time and stdout/stderr activity (the heartbeat proxy
 * — no other liveness signal exists at the process-I/O level). On breach
 * it signals the whole group, not just the immediate child: a spawned
 * agent CLI that forks its own subprocesses (tool calls, dev servers)
 * would otherwise leave those grandchildren running past the kill.
 *
 * `onBreach` fires synchronously the instant the threshold is crossed —
 * before SIGTERM/SIGKILL finish tearing the tree down or stdout/stderr
 * finish draining. Callers wire it straight to `deadLetterAndBlock` so
 * the ticket flips within seconds independent of teardown time (FR-H2).
 *
 * Produces a plain `SpawnSession` — the exact `@shipwright/loop` contract
 * `loop-claim.ts`/`loop-land.ts` already use — so wiring this in later is
 * a drop-in swap for `createChildProcessSpawn`, no changes needed outside
 * this ticket's write-scope.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import type { SpawnSession, SpawnSessionOutput } from '@shipwright/loop';
import {
  checkWatchdogBreach,
  type WatchdogBreach,
  type WatchdogLimits,
} from './watchdog.js';

export interface WatchdogChildProcessSpawnOptions extends WatchdogLimits {
  readonly command: string;
  /** Extra args before the prompt, e.g. ['-p'] for a `<cli> -p <prompt>` shape. */
  readonly args?: readonly string[];
  /** Defaults to just PATH — an agent session is untrusted and must not inherit the parent's env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How often the clocks are checked. Defaults to 1/10th the tighter limit, floored at 20ms. */
  readonly pollIntervalMs?: number;
  /** Grace period after SIGTERM before escalating to SIGKILL on a tree that ignores it. */
  readonly forceKillGraceMs?: number;
  readonly onBreach: (breach: WatchdogBreach) => void;
}

const MINIMAL_SPAWN_ENV: Readonly<Record<string, string | undefined>> = {
  PATH: process.env.PATH,
};

const DEFAULT_FORCE_KILL_GRACE_MS = 2_000;

/** Signals the whole process group (negative pid), not just the direct child — see module doc. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone (process exited on its own between poll and kill).
  }
}

function defaultPollIntervalMs(limits: WatchdogLimits): number {
  const tighterSeconds = Math.min(limits.maxSessionSeconds, limits.heartbeatStallSeconds);
  return Math.max(20, Math.floor((tighterSeconds * 1000) / 10));
}

/**
 * Spawns `command [...args] prompt` in `input.cwd`, in its own process
 * group, watched by the two clocks in `options`. Resolves once the
 * process (or its whole killed group) has exited — never rejects; a spawn
 * error surfaces as `exitCode: null` with the error message appended to
 * stderr, matching `createChildProcessSpawn`'s own contract.
 */
export function createWatchdogChildProcessSpawn(
  options: WatchdogChildProcessSpawnOptions,
): SpawnSession {
  return (input) =>
    new Promise<SpawnSessionOutput>((resolve) => {
      const startedAtMs = Date.now();
      let lastHeartbeatAtMs = startedAtMs;
      let breached = false;
      let stdout = '';
      let stderr = '';

      const child = nodeSpawn(options.command, [...(options.args ?? []), input.prompt], {
        cwd: input.cwd,
        env: options.env ?? MINIMAL_SPAWN_ENV,
        detached: true,
      });

      const heartbeat = (): void => {
        lastHeartbeatAtMs = Date.now();
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        heartbeat();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        heartbeat();
      });

      const poll = setInterval(
        () => {
          if (breached) return;
          const breach = checkWatchdogBreach(
            options,
            { startedAtMs, lastHeartbeatAtMs },
            Date.now(),
          );
          if (!breach) return;
          breached = true;
          clearInterval(poll);
          options.onBreach(breach);
          if (typeof child.pid === 'number') killGroup(child.pid, 'SIGTERM');
          const forceKill = setTimeout(() => {
            if (typeof child.pid === 'number') killGroup(child.pid, 'SIGKILL');
          }, options.forceKillGraceMs ?? DEFAULT_FORCE_KILL_GRACE_MS);
          child.once('close', () => clearTimeout(forceKill));
        },
        options.pollIntervalMs ?? defaultPollIntervalMs(options),
      );

      child.on('error', (err) => {
        clearInterval(poll);
        resolve({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: null });
      });
      child.on('close', (exitCode) => {
        clearInterval(poll);
        resolve({ stdout, stderr, exitCode });
      });
    });
}
