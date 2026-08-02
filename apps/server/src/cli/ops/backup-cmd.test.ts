import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIO } from '../../bootstrap/cli.js';
import { runBackupCommand } from './backup-cmd.js';

describe('runBackupCommand', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchIo(): Promise<CliIO> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-backup-cmd-'));
    scratchDirs.push(projectDir);
    return { stdout: vi.fn(), stderr: vi.fn(), cwd: projectDir, env: {} };
  }

  it('backs up then prunes with the default retention', async () => {
    const io = await scratchIo();
    const createOnlineBackup = vi.fn().mockResolvedValue('/fake/backups/online-1.db');
    const pruneBackups = vi.fn().mockResolvedValue({ kept: ['online-1.db'], pruned: [] });

    const code = await runBackupCommand(io, { createOnlineBackup, pruneBackups });

    expect(code).toBe(0);
    expect(createOnlineBackup).toHaveBeenCalledWith(
      path.join(io.cwd, '.dokima', 'state.db'),
      path.join(io.cwd, '.dokima', 'backups'),
      expect.objectContaining({ now: io.now }),
    );
    expect(pruneBackups).toHaveBeenCalledWith(
      path.join(io.cwd, '.dokima', 'backups'),
      7,
    );
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('/fake/backups/online-1.db'),
    );
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('kept 1, pruned 0'));
  });

  it('honors a custom retention count', async () => {
    const io = await scratchIo();
    const createOnlineBackup = vi.fn().mockResolvedValue('/fake/backups/online-1.db');
    const pruneBackups = vi.fn().mockResolvedValue({ kept: [], pruned: [] });

    await runBackupCommand(io, { createOnlineBackup, pruneBackups, retentionCount: 3 });

    expect(pruneBackups).toHaveBeenCalledWith(expect.any(String), 3);
  });

  it('reports failure instead of throwing when the db cannot be backed up', async () => {
    const io = await scratchIo();
    const createOnlineBackup = vi.fn().mockRejectedValue(new Error('no such file'));
    const pruneBackups = vi.fn();

    const code = await runBackupCommand(io, { createOnlineBackup, pruneBackups });

    expect(code).toBe(1);
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('backup refused'));
    expect(pruneBackups).not.toHaveBeenCalled();
  });
});
