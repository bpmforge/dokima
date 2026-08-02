import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLog } from '@dokima/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectPaths } from './config.js';
import { runPackagedCli, type CliIO } from './cli.js';

describe('runPackagedCli', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchProject(): Promise<{ projectDir: string; io: CliIO }> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-cli-'));
    scratchDirs.push(projectDir);
    return {
      projectDir,
      io: {
        stdout: vi.fn(),
        stderr: vi.fn(),
        cwd: projectDir,
        env: {},
      },
    };
  }

  function fakeBootResult(projectDir: string) {
    const paths = resolveProjectPaths(projectDir);
    const log = openEventLog(':memory:');
    return {
      log,
      report: {
        paths,
        backupPath: null,
        orphaned: [],
        tailCheck: {
          valid: true,
          checkedFrom: null,
          checkedTo: null,
          brokenAtSeq: null,
          reason: null,
        },
        highWater: { truncated: false, recordedSeq: 0, currentSeq: 0 },
      },
    };
  }

  it('dispatches to packsUpdate for `packs update`', async () => {
    const { io } = await scratchProject();
    const packsUpdate = vi.fn().mockResolvedValue({
      manifestValid: true,
      licenseAllowlisted: true,
      verifiedFiles: ['a.sh'],
      rejectedFiles: [],
      manifest: {},
      installedTo: '/fake/packs/first-party',
    });

    const code = await runPackagedCli(['packs', 'update'], io, { packsUpdate });
    expect(code).toBe(0);
    expect(packsUpdate).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('1 file(s) verified'));
  });

  it('reports failure when packs update rejects the signature', async () => {
    const { io } = await scratchProject();
    const packsUpdate = vi.fn().mockResolvedValue({
      manifestValid: false,
      licenseAllowlisted: false,
      verifiedFiles: [],
      rejectedFiles: [{ path: 'a.sh', reason: 'file-hash-mismatch' }],
      manifest: {},
      installedTo: '/fake',
    });

    const code = await runPackagedCli(['packs', 'update'], io, { packsUpdate });
    expect(code).toBe(1);
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('refused'));
  });

  it('detects an already-running core and opens the Canvas without rebinding', async () => {
    const { projectDir, io } = await scratchProject();
    const boot = fakeBootResult(projectDir);
    const runBootSequence = vi.fn().mockResolvedValue(boot);
    const detectRunningCore = vi.fn().mockResolvedValue(true);
    const openBrowser = vi.fn();
    const buildApiServer = vi.fn();
    const listenLocalhost = vi.fn();

    const code = await runPackagedCli([], io, {
      runBootSequence,
      detectRunningCore,
      openBrowser,
      buildApiServer,
      listenLocalhost,
    });

    expect(code).toBe(0);
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4317');
    expect(runBootSequence).not.toHaveBeenCalled();
    expect(buildApiServer).not.toHaveBeenCalled();
    expect(listenLocalhost).not.toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('already running'));
  });

  it('binds a fresh server + opens the Canvas when nothing is running yet', async () => {
    const { projectDir, io } = await scratchProject();
    await fs.mkdir(resolveProjectPaths(projectDir).dokimaDir, { recursive: true });
    const boot = fakeBootResult(projectDir);
    const runBootSequence = vi.fn().mockResolvedValue(boot);
    const detectRunningCore = vi.fn().mockResolvedValue(false);
    const openBrowser = vi.fn();
    const addHook = vi.fn();
    const buildApiServer = vi.fn().mockResolvedValue({ app: { addHook }, wsHub: {} });
    const listenLocalhost = vi.fn().mockResolvedValue(undefined);
    const ensureAuthToken = vi
      .fn()
      .mockResolvedValue({ token: 'tok', tokenPath: '/fake/token' });

    const code = await runPackagedCli([], io, {
      runBootSequence,
      detectRunningCore,
      openBrowser,
      buildApiServer,
      listenLocalhost,
      ensureAuthToken,
    });

    expect(code).toBe(0);
    expect(buildApiServer).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', port: 4317 }),
    );
    expect(listenLocalhost).toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4317');
    expect(addHook).toHaveBeenCalledWith('onClose', expect.any(Function));
  });

  it('honors DOKIMA_PORT', async () => {
    const { projectDir, io } = await scratchProject();
    io.env.DOKIMA_PORT = '5555';
    const boot = fakeBootResult(projectDir);
    const runBootSequence = vi.fn().mockResolvedValue(boot);
    const detectRunningCore = vi.fn().mockResolvedValue(true);
    const openBrowser = vi.fn();

    await runPackagedCli([], io, { runBootSequence, detectRunningCore, openBrowser });
    expect(detectRunningCore).toHaveBeenCalledWith({ port: 5555 });
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:5555');
  });

  it('reports a boot-sequence refusal (e.g. downgrade) as a failure, never booting past it', async () => {
    const { io } = await scratchProject();
    const runBootSequence = vi
      .fn()
      .mockRejectedValue(new Error('refusing to open: downgrade'));
    const detectRunningCore = vi.fn().mockResolvedValue(false);

    const code = await runPackagedCli([], io, { runBootSequence, detectRunningCore });
    expect(code).toBe(1);
    expect(detectRunningCore).toHaveBeenCalled();
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('downgrade'));
  });

  it('skips the boot sequence entirely when a core is already running (no double-bind, no false orphan sweep)', async () => {
    const { io } = await scratchProject();
    const runBootSequence = vi.fn().mockRejectedValue(new Error('should not be called'));
    const detectRunningCore = vi.fn().mockResolvedValue(true);
    const openBrowser = vi.fn();

    const code = await runPackagedCli([], io, {
      runBootSequence,
      detectRunningCore,
      openBrowser,
    });

    expect(code).toBe(0);
    expect(runBootSequence).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4317');
  });

  it('dispatches `backup` to the backup command with its own deps', async () => {
    const { io } = await scratchProject();
    const createOnlineBackup = vi.fn().mockResolvedValue('/fake/backups/online-1.db');
    const pruneBackups = vi.fn().mockResolvedValue({ kept: [], pruned: [] });

    const code = await runPackagedCli(['backup'], io, {
      backup: { createOnlineBackup, pruneBackups },
    });

    expect(code).toBe(0);
    expect(createOnlineBackup).toHaveBeenCalled();
  });

  it('dispatches `doctor` to the doctor command with its own deps', async () => {
    const { io } = await scratchProject();
    const detectRunningCoreForDoctor = vi.fn().mockResolvedValue(false);

    const code = await runPackagedCli(['doctor'], io, {
      doctor: {
        detectRunningCore: detectRunningCoreForDoctor,
        resolveCredentialStore: () => ({
          get: vi.fn().mockResolvedValue('ok'),
          set: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        }),
        loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      },
    });

    expect(code).toBe(0);
    expect(detectRunningCoreForDoctor).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('doctor: OK'));
  });

  it('dispatches `service <subcommand>` to the service command, refusing an unknown subcommand', async () => {
    const { io } = await scratchProject();
    const exec = vi
      .fn()
      .mockResolvedValue({ stdout: 'active\n', stderr: '', exitCode: 0 });

    const code = await runPackagedCli(['service', 'status'], io, {
      service: { platform: 'linux', exec },
    });
    expect(code).toBe(0);
    expect(exec).toHaveBeenCalled();

    const badCode = await runPackagedCli(['service', 'bogus'], io);
    expect(badCode).toBe(2);
    expect(io.stderr).toHaveBeenCalledWith(
      expect.stringContaining('usage: dokima service'),
    );
  });

  it('dispatches `providers refresh` to the providers-refresh command with its own deps', async () => {
    const { io } = await scratchProject();
    const loadConfiguredProviders = vi.fn().mockResolvedValue([]);

    const code = await runPackagedCli(['providers', 'refresh'], io, {
      providersRefresh: { loadConfiguredProviders },
    });

    expect(code).toBe(0);
    expect(loadConfiguredProviders).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('nothing to refresh'));
  });
});
