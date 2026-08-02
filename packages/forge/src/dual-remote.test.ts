import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { pushToRemotes } from './dual-remote.js';

const execFileAsync = promisify(execFile);

async function gitIn(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

/** A bare repo standing in for a real forge remote — local filesystem only, no network. */
async function createBareRemote(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-dual-remote-bare-'));
  await gitIn(dir, ['init', '--bare', '-b', 'main']);
  return dir;
}

async function createWorkingRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-dual-remote-work-'));
  await gitIn(dir, ['init', '-b', 'main']);
  await gitIn(dir, ['config', 'user.name', 'Dokima Test']);
  await gitIn(dir, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(dir, 'README.md'), '# fixture\n');
  await gitIn(dir, ['add', '--', 'README.md']);
  await gitIn(dir, ['commit', '-m', 'chore: initial commit']);
  return dir;
}

describe('pushToRemotes', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    cleanupDirs.length = 0;
  });

  it('pushes to every configured remote and reports ok per remote', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    const remoteA = await createBareRemote();
    cleanupDirs.push(remoteA);
    const remoteB = await createBareRemote();
    cleanupDirs.push(remoteB);

    await gitIn(repo, ['remote', 'add', 'origin', remoteA]);
    await gitIn(repo, ['remote', 'add', 'github', remoteB]);

    const results = await pushToRemotes({
      cwd: repo,
      remotes: ['origin', 'github'],
      ref: 'main',
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.remote)).toEqual(['origin', 'github']);
    expect(results.every((r) => r.ok)).toBe(true);

    const { stdout: shaLocal } = await gitIn(repo, ['rev-parse', 'main']);
    const { stdout: shaA } = await gitIn(remoteA, ['rev-parse', 'main']);
    const { stdout: shaB } = await gitIn(remoteB, ['rev-parse', 'main']);
    expect(shaA.trim()).toBe(shaLocal.trim());
    expect(shaB.trim()).toBe(shaLocal.trim());
  });

  it('isolates a failing remote: one unreachable remote does not block or throw for the others', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    const goodRemote = await createBareRemote();
    cleanupDirs.push(goodRemote);

    await gitIn(repo, ['remote', 'add', 'origin', goodRemote]);
    // A remote pointing at a path that doesn't exist — stands in for an
    // unreachable/offline forge (e.g. Gitea off-LAN, CLAUDE.md law 10) —
    // no real network involved, still fully local-first.
    const badRemotePath = path.join(
      os.tmpdir(),
      'dokima-dual-remote-missing-so-invalid',
    );
    await gitIn(repo, ['remote', 'add', 'github', badRemotePath]);

    const results = await pushToRemotes({
      cwd: repo,
      remotes: ['origin', 'github'],
      ref: 'main',
    });

    expect(results).toHaveLength(2);
    const origin = results.find((r) => r.remote === 'origin');
    const github = results.find((r) => r.remote === 'github');
    expect(origin?.ok).toBe(true);
    expect(github?.ok).toBe(false);
    expect(github?.detail.length).toBeGreaterThan(0);
  });

  it('returns per-remote results in the same order as the input remotes array', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    const remoteA = await createBareRemote();
    cleanupDirs.push(remoteA);
    const remoteB = await createBareRemote();
    cleanupDirs.push(remoteB);
    await gitIn(repo, ['remote', 'add', 'zzz-last', remoteA]);
    await gitIn(repo, ['remote', 'add', 'aaa-first', remoteB]);

    const results = await pushToRemotes({
      cwd: repo,
      remotes: ['zzz-last', 'aaa-first'],
      ref: 'main',
    });

    expect(results.map((r) => r.remote)).toEqual(['zzz-last', 'aaa-first']);
  });
});
