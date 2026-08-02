import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureConfigDirs,
  resolveHomePaths,
  resolveLogLevel,
  resolveProjectPaths,
} from './config.js';

describe('resolveLogLevel', () => {
  it('defaults to info when unset', () => {
    expect(resolveLogLevel({})).toBe('info');
  });

  it('accepts debug', () => {
    expect(resolveLogLevel({ DOKIMA_LOG_LEVEL: 'debug' })).toBe('debug');
  });

  it('falls back to info for an unrecognized value', () => {
    expect(resolveLogLevel({ DOKIMA_LOG_LEVEL: 'verbose' })).toBe('info');
  });
});

describe('resolveHomePaths', () => {
  it('honors DOKIMA_HOME', () => {
    const home = resolveHomePaths({ DOKIMA_HOME: '/tmp/sw-home' });
    expect(home.home).toBe('/tmp/sw-home');
    expect(home.packsDir).toBe('/tmp/sw-home/packs');
  });
});

describe('resolveProjectPaths', () => {
  it('derives .dokima/ layout from the project dir', () => {
    const paths = resolveProjectPaths('/tmp/my-project');
    expect(paths.dokimaDir).toBe('/tmp/my-project/.dokima');
    expect(paths.dbPath).toBe('/tmp/my-project/.dokima/state.db');
    expect(paths.backupsDir).toBe('/tmp/my-project/.dokima/backups');
    expect(paths.worktreesDir).toBe('/tmp/my-project/.dokima/worktrees');
  });
});

describe('ensureConfigDirs', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('creates ~/.dokima and <project>/.dokima, mode 0700', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-home-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-project-'));
    scratchDirs.push(home, projectDir);

    const { home: homePaths, project } = await ensureConfigDirs(projectDir, {
      DOKIMA_HOME: home,
    });

    const homeStat = await fs.stat(homePaths.home);
    const projectStat = await fs.stat(project.dokimaDir);
    expect(homeStat.mode & 0o777).toBe(0o700);
    expect(projectStat.mode & 0o777).toBe(0o700);
    await expect(fs.stat(homePaths.packsDir)).resolves.toBeDefined();
    await expect(fs.stat(project.backupsDir)).resolves.toBeDefined();
    await expect(fs.stat(project.worktreesDir)).resolves.toBeDefined();
  });
});
