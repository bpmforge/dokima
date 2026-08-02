/**
 * Restricted-process sandbox profile (SC-07 default). Runs `bash -c
 * <command>` in `cwd` under a cleaned env, in its own process group (the
 * `@dokima/validators` `run.ts` / `watchdog-process.ts` hang-kill
 * pattern), and — unless the caller opts in per project — wrapped so the
 * OS itself refuses network egress, loopback included (THREAT_MODEL §5.6):
 *
 *   - macOS: `sandbox-exec` (Seatbelt) with a `(deny network*)` profile.
 *   - Linux: `unshare --net -r --` (an empty, unprivileged net namespace —
 *     no interface is ever brought up, not even `lo`, so a connect() to
 *     `127.0.0.1` fails exactly like a connect() to the outside world).
 *
 * Neither mechanism is emulated or best-effort: if the platform binary is
 * missing, or a capability preflight shows it doesn't actually isolate the
 * network on this host, the run refuses (`SandboxUnavailableError`) rather
 * than silently executing with network open.
 */

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSandboxEnv } from './env.js';
import {
  SandboxUnavailableError,
  type SandboxRunOptions,
  type SandboxRunResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FORCE_KILL_GRACE_MS = 2_000;

const SEATBELT_DENY_NETWORK_PROFILE = '(version 1)\n(allow default)\n(deny network*)\n';

/** Signals the whole process group (negative pid), not just the direct child. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone.
  }
}

function probeAvailable(binary: string, args: readonly string[]): boolean {
  const probe = spawnSync(binary, [...args], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Builds the `[command, args]` that actually get spawned: either the bare
 * `bash -c <command>` (network allowed — no wrapper needed) or that same
 * invocation wrapped in the platform's network-denial mechanism. Throws
 * `SandboxUnavailableError` up front (before spawning anything) when
 * network must be denied but this host can't actually do it.
 */
function resolveInvocation(
  command: string,
  allowNetwork: boolean,
  seatbeltProfilePath: string | undefined,
): { command: string; args: string[] } {
  const bashInvocation = { command: 'bash', args: ['-c', command] };
  if (allowNetwork) return bashInvocation;

  if (process.platform === 'darwin') {
    if (seatbeltProfilePath === undefined) {
      throw new SandboxUnavailableError(
        'darwin sandbox profile was not prepared before resolveInvocation',
      );
    }
    if (
      !probeAvailable('sandbox-exec', [
        '-p',
        '(version 1)(allow default)',
        '/usr/bin/true',
      ])
    ) {
      throw new SandboxUnavailableError(
        'sandbox-exec is unavailable on this host — refusing to run without network isolation (SC-07)',
      );
    }
    return {
      command: 'sandbox-exec',
      args: ['-f', seatbeltProfilePath, 'bash', '-c', command],
    };
  }

  if (process.platform === 'linux') {
    if (!probeAvailable('unshare', ['--net', '-r', '--', 'true'])) {
      throw new SandboxUnavailableError(
        'unshare --net is unavailable (missing binary, or unprivileged net namespaces are ' +
          'disabled on this host) — refusing to run without network isolation (SC-07)',
      );
    }
    return {
      command: 'unshare',
      args: ['--net', '-r', '--', 'bash', '-c', command],
    };
  }

  throw new SandboxUnavailableError(
    `no network-isolation mechanism is implemented for platform "${process.platform}" — ` +
      'refusing to run without network isolation (SC-07)',
  );
}

/**
 * Keeps the Seatbelt profile file alive for the full duration of `run` —
 * including the spawned child's lifetime, not just argv construction — and
 * only cleans up once `run`'s returned promise settles. Cleaning up earlier
 * (e.g. in a `finally` around only the argv-building step) deletes the
 * profile out from under `sandbox-exec` before it has a chance to read it.
 */
async function withSeatbeltProfile<T>(
  needed: boolean,
  run: (profilePath: string | undefined) => Promise<T>,
): Promise<T> {
  if (!needed || process.platform !== 'darwin') return run(undefined);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dokima-sandbox-'));
  const profilePath = path.join(dir, `${randomUUID()}.sb`);
  await writeFile(profilePath, SEATBELT_DENY_NETWORK_PROFILE, 'utf8');
  try {
    return await run(profilePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function spawnAndWait(
  invocation: { command: string; args: string[] },
  cwd: string,
  env: NodeJS.ProcessEnv,
  originalCommand: string,
  allowNetwork: boolean,
  timeoutMs: number,
  forceKillGraceMs: number,
): Promise<SandboxRunResult> {
  const start = Date.now();
  return new Promise<SandboxRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      detached: true,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (typeof child.pid === 'number') killGroup(child.pid, 'SIGTERM');
    }, timeoutMs);
    const forceKillTimer = setTimeout(() => {
      if (typeof child.pid === 'number') killGroup(child.pid, 'SIGKILL');
    }, timeoutMs + forceKillGraceMs);

    const settle = (exitCode: number | null): void => {
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      resolve({
        profile: 'process',
        command: originalCommand,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
        networkAllowed: allowNetwork,
      });
    };

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      settle(null);
    });
    child.on('close', (exitCode) => {
      settle(exitCode);
    });
  });
}

/** True when this host's network-denial mechanism is actually usable — see module doc. */
export function isProcessSandboxAvailable(): boolean {
  if (process.platform === 'darwin') {
    return probeAvailable('sandbox-exec', [
      '-p',
      '(version 1)(allow default)',
      '/usr/bin/true',
    ]);
  }
  if (process.platform === 'linux') {
    return probeAvailable('unshare', ['--net', '-r', '--', 'true']);
  }
  return false;
}

export async function runInProcessSandbox(
  options: SandboxRunOptions,
): Promise<SandboxRunResult> {
  const allowNetwork = options.allowNetwork ?? false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forceKillGraceMs = options.forceKillGraceMs ?? DEFAULT_FORCE_KILL_GRACE_MS;
  const env = buildSandboxEnv(options.env);

  return withSeatbeltProfile(!allowNetwork, (profilePath) => {
    const invocation = resolveInvocation(options.command, allowNetwork, profilePath);
    return spawnAndWait(
      invocation,
      options.cwd,
      env,
      options.command,
      allowNetwork,
      timeoutMs,
      forceKillGraceMs,
    );
  });
}
