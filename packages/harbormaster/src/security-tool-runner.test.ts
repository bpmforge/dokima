/**
 * W23-54 — the security tools under the opt-in container profile.
 *
 * Only the worktree was mounted (at /work), so opengrep's pinned ruleset —
 * a host path, on the founder's machine a SYMLINK into ~/Code/bpm-rulepacks —
 * did not exist inside the container, and neither did the bundled secrets
 * scanner. The runner now mounts exactly the runtime-owned paths a tool's
 * command line names, read-only, at the path the command line uses, and
 * names the container profile when the image cannot start the tool.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURITY_TOOLS } from './security-checks.js';
import { sandboxedToolRunner } from './security-tool-runner.js';
import type { SandboxRunOptions, SandboxRunResult } from './sandbox/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const adapter = (id: string) => SECURITY_TOOLS.find((a) => a.checkId === id)!;

function recorder(answer: Partial<SandboxRunResult> = {}) {
  const calls: SandboxRunOptions[] = [];
  const run = async (o: SandboxRunOptions): Promise<SandboxRunResult> => {
    calls.push(o);
    return {
      profile: o.profile ?? 'process',
      command: o.command,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false,
      networkAllowed: false,
      ...answer,
    };
  };
  return { calls, run };
}

describe('W23-54: security tools under the container profile', () => {
  it('RED: the pinned ruleset is mounted read-only at the path --config names, sourced from its real path', async () => {
    const real = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-rules-real-'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-rules-home-'));
    dirs.push(real, home);
    await fs.mkdir(path.join(real, 'owasp'));
    const link = path.join(home, 'sast');
    await fs.symlink(real, link);
    const configPath = path.join(link, 'owasp');

    const { calls, run } = recorder();
    await sandboxedToolRunner({ profile: 'container', run })(
      adapter('tool-sast'),
      ['scan', '--config', configPath, '--json', '.'],
      {
        cwd: '/host/worktree',
        allowNetwork: false,
        timeoutMs: 1000,
        readOnlyPaths: [configPath],
      },
    );
    expect(calls[0]!.profile).toBe('container');
    expect(calls[0]!.readOnlyMounts).toEqual([
      { source: await fs.realpath(configPath), target: configPath },
    ]);
  });

  it('the worktree argument becomes /work inside the container (the host path is not mounted there)', async () => {
    const { calls, run } = recorder();
    await sandboxedToolRunner({ profile: 'container', run })(
      adapter('tool-secrets'),
      ['/opt/dokima/content/validators/secrets-scan.sh', '/host/worktree'],
      {
        cwd: '/host/worktree',
        allowNetwork: false,
        timeoutMs: 1000,
        readOnlyPaths: ['/opt/dokima/content/validators'],
      },
    );
    expect(calls[0]!.command).toContain('/work');
    expect(calls[0]!.command).not.toContain('/host/worktree');
  });

  it('exit 127 in the container says which profile and image could not start the tool', async () => {
    const { run } = recorder({ exitCode: 127, stderr: 'sh: 1: opengrep: not found' });
    const result = await sandboxedToolRunner({
      profile: 'container',
      container: { image: 'node:22-slim' },
      run,
    })(adapter('tool-sast'), ['scan', '.'], {
      cwd: '/w',
      allowNetwork: false,
      timeoutMs: 1000,
    });
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toMatch(/container profile/);
    expect(result.stderr).toMatch(/node:22-slim/);
  });

  it('the process profile is the default and mounts nothing (it reads the host directly)', async () => {
    const { calls, run } = recorder();
    await sandboxedToolRunner({ run })(adapter('tool-sast'), ['scan', '.'], {
      cwd: '/w',
      allowNetwork: false,
      timeoutMs: 1000,
      readOnlyPaths: ['/r'],
    });
    expect(calls[0]!.profile ?? 'process').toBe('process');
    expect(calls[0]!.readOnlyMounts ?? []).toEqual([]);
  });
});
