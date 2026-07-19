/**
 * Optional Podman/Docker container profile (DEPLOYMENT.md §5). Isolation
 * strength only changes vs. the process profile — same `SandboxRunResult`
 * shape, same fail-closed posture on an unavailable/misconfigured runtime.
 *
 * `--network=none` gives the container its own empty network namespace: no
 * interface is configured (not even a routable loopback to the *host's*
 * 127.0.0.1 — a container's `lo` is private to its own netns), so this
 * covers THREAT_MODEL §5.6 the same way the process profile's namespace/
 * Seatbelt denial does, by construction rather than by rule-matching.
 */

import { spawn, spawnSync } from 'node:child_process';
import type {
  SandboxContainerOptions,
  SandboxRunOptions,
  SandboxRunResult,
} from './types.js';
import { SandboxUnavailableError } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FORCE_KILL_GRACE_MS = 2_000;
const DEFAULT_IMAGE = 'node:22-slim';
const DEFAULT_CPUS = 2;
const DEFAULT_MEMORY = '2g';
const DEFAULT_PIDS_LIMIT = 256;

const CONTAINER_BINARIES = ['podman', 'docker'] as const;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone.
  }
}

function binaryAvailable(binary: string): boolean {
  const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

/** Podman preferred over Docker per DEPLOYMENT.md §5's ordering. */
function resolveBinary(requested: 'podman' | 'docker' | undefined): string {
  if (requested !== undefined) {
    if (!binaryAvailable(requested)) {
      throw new SandboxUnavailableError(
        `container profile requested "${requested}" but it is not available on this host`,
      );
    }
    return requested;
  }
  const found = CONTAINER_BINARIES.find(binaryAvailable);
  if (found === undefined) {
    throw new SandboxUnavailableError(
      'container profile requires Podman or Docker; neither is available on this host',
    );
  }
  return found;
}

function buildRunArgs(
  binary: string,
  cwd: string,
  command: string,
  allowNetwork: boolean,
  container: SandboxContainerOptions,
): string[] {
  const image = container.image ?? DEFAULT_IMAGE;
  return [
    'run',
    '--rm',
    '-v',
    `${cwd}:/work:rw`,
    '-w',
    '/work',
    '--network',
    allowNetwork ? 'bridge' : 'none',
    '--user',
    '1000:1000',
    '--cpus',
    String(container.cpus ?? DEFAULT_CPUS),
    '--memory',
    container.memory ?? DEFAULT_MEMORY,
    '--pids-limit',
    String(container.pidsLimit ?? DEFAULT_PIDS_LIMIT),
    '--tmpfs',
    '/tmp',
    // No -e flags: neither binary passes host env into the container by
    // default, so this is already a cleaned env (SC-07) with zero extra work.
    image,
    // `sh`, not `bash`: a project may pin a minimal image (DEPLOYMENT.md §5)
    // that has no bash at all (e.g. `node:*-alpine`'s busybox base) — every
    // image ships a POSIX `sh`.
    'sh',
    '-c',
    command,
  ];
}

export async function runInContainerSandbox(
  options: SandboxRunOptions,
): Promise<SandboxRunResult> {
  const allowNetwork = options.allowNetwork ?? false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forceKillGraceMs = options.forceKillGraceMs ?? DEFAULT_FORCE_KILL_GRACE_MS;
  const container = options.container ?? {};
  const binary = resolveBinary(container.binary);
  const args = buildRunArgs(
    binary,
    options.cwd,
    options.command,
    allowNetwork,
    container,
  );

  const start = Date.now();
  return new Promise<SandboxRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(binary, args, { detached: true });

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
        profile: 'container',
        command: options.command,
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

/** Exposed for tests/callers that want to skip container tests when no runtime is present. */
export function isContainerRuntimeAvailable(): boolean {
  return CONTAINER_BINARIES.some(binaryAvailable);
}
