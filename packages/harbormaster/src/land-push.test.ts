import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog } from '@shipwright/events';
import { git } from '@shipwright/git';
import { createTicket } from '@shipwright/tickets';
import {
  configuredRemotes,
  pushLandedBranch,
  recordFailedPushes,
  type PushToRemotesFn,
} from './land-push.js';

async function createWorkingRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-land-push-work-'));
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'Shipwright Test']);
  await git(dir, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(dir, 'README.md'), '# fixture\n');
  await git(dir, ['add', '--', 'README.md']);
  await git(dir, ['commit', '-m', 'chore: initial commit']);
  return dir;
}

describe('configuredRemotes', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    cleanupDirs.length = 0;
  });

  it('returns an empty array when the repo has no remotes configured (local-first, Law 9/C-1)', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);

    expect(await configuredRemotes(repo)).toEqual([]);
  });

  it('returns every configured remote name', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    await git(repo, ['remote', 'add', 'origin', '/tmp/does-not-need-to-exist-origin']);
    await git(repo, ['remote', 'add', 'github', '/tmp/does-not-need-to-exist-github']);

    expect(await configuredRemotes(repo)).toEqual(['github', 'origin']);
  });
});

describe('pushLandedBranch', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    cleanupDirs.length = 0;
  });

  it('does not call pushToRemotes when the repo has zero configured remotes', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    const pushToRemotes: PushToRemotesFn = async () => {
      throw new Error('pushToRemotes must not be called with zero remotes');
    };

    await expect(pushLandedBranch(pushToRemotes, repo, 'main')).resolves.toEqual([]);
  });

  it('pushes to whatever remotes are configured on the repo when no explicit list is given', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    await git(repo, ['remote', 'add', 'origin', '/tmp/does-not-need-to-exist-origin']);

    const calls: { cwd: string; remotes: readonly string[]; ref: string }[] = [];
    const pushToRemotes: PushToRemotesFn = async (options) => {
      calls.push(options);
      return options.remotes.map((remote) => ({ remote, ok: true, detail: '' }));
    };

    await pushLandedBranch(pushToRemotes, repo, 'main');

    expect(calls).toEqual([{ cwd: repo, remotes: ['origin'], ref: 'main' }]);
  });

  it('prefers an explicit remotes list over the repo-configured set', async () => {
    const repo = await createWorkingRepo();
    cleanupDirs.push(repo);
    await git(repo, ['remote', 'add', 'origin', '/tmp/does-not-need-to-exist-origin']);

    const calls: { cwd: string; remotes: readonly string[]; ref: string }[] = [];
    const pushToRemotes: PushToRemotesFn = async (options) => {
      calls.push(options);
      return options.remotes.map((remote) => ({ remote, ok: true, detail: '' }));
    };

    await pushLandedBranch(pushToRemotes, repo, 'main', ['explicit-only']);

    expect(calls).toEqual([{ cwd: repo, remotes: ['explicit-only'], ref: 'main' }]);
  });
});

describe('recordFailedPushes', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    cleanupDirs.length = 0;
  });

  async function setupLog() {
    const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-land-push-log-'));
    cleanupDirs.push(dbDir);
    const log = openEventLog(path.join(dbDir, 'state.db'));
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    createTicket(log, 'worker-1', {
      id: 'W9-01',
      type: 'task',
      title: 'Ticket W9-01',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
    return log;
  }

  it('is a no-op when every remote push succeeded', async () => {
    const log = await setupLog();

    recordFailedPushes(log, 'worker-1', 'W9-01', [
      { remote: 'origin', ok: true, detail: '' },
      { remote: 'github', ok: true, detail: '' },
    ]);

    expect(listEvents(log).some((event) => event.eventType === 'ticket.commented')).toBe(
      false,
    );
    log.close();
  });

  it('comments the ticket with the failing remote(s) — never swallowed (review-caught HIGH)', async () => {
    const log = await setupLog();

    recordFailedPushes(log, 'worker-1', 'W9-01', [
      { remote: 'origin', ok: true, detail: '' },
      { remote: 'github', ok: false, detail: 'connection timed out' },
    ]);

    const comments = listEvents(log).filter(
      (event) => event.eventType === 'ticket.commented',
    );
    expect(comments).toHaveLength(1);
    const body = (comments[0]!.payload as { body: string }).body;
    expect(body).toContain('github');
    expect(body).toContain('connection timed out');
    log.close();
  });
});
