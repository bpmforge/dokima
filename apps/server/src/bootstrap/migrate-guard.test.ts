import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLog } from '@dokima/events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupBeforeMigrate,
  checkSchemaCompatibility,
  DowngradeRefusedError,
  latestKnownSchemaVersion,
} from './migrate-guard.js';

describe('migrate-guard', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchDbPath(): Promise<{ dir: string; dbPath: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-migrate-guard-'));
    scratchDirs.push(dir);
    return { dir, dbPath: path.join(dir, 'state.db') };
  }

  it('reports compatible + dbExists=false for a fresh project (no db file yet)', async () => {
    const { dbPath } = await scratchDbPath();
    const result = await checkSchemaCompatibility(dbPath);
    expect(result.compatible).toBe(true);
    expect(result.dbExists).toBe(false);
    expect(result.dbVersion).toBe(0);
    expect(result.latestVersion).toBeGreaterThan(0);
  });

  it('reports compatible + up to date once opened at the latest version', async () => {
    const { dbPath } = await scratchDbPath();
    const log = openEventLog(dbPath);
    log.close();

    const result = await checkSchemaCompatibility(dbPath);
    expect(result.compatible).toBe(true);
    expect(result.dbExists).toBe(true);
    expect(result.dbVersion).toBe(result.latestVersion);
  });

  it('flags incompatible when the db user_version is newer than this binary knows', async () => {
    const { dbPath } = await scratchDbPath();
    const log = openEventLog(dbPath);
    const future = latestKnownSchemaVersion() + 1;
    log.db.pragma(`user_version = ${future}`);
    log.close();

    const result = await checkSchemaCompatibility(dbPath);
    expect(result.compatible).toBe(false);
    expect(result.dbVersion).toBe(future);
  });

  it('DowngradeRefusedError names the backup-restore path', () => {
    const err = new DowngradeRefusedError('/proj/.dokima/state.db', 13, 12);
    expect(err.message).toMatch(/backup/i);
    expect(err.message).toMatch(/\.dokima\/backups/);
    expect(err.message).toMatch(/downgrade/i);
  });

  it('backupBeforeMigrate is a no-op for a fresh (nonexistent) db', async () => {
    const { dbPath, dir } = await scratchDbPath();
    const compat = await checkSchemaCompatibility(dbPath);
    const backup = await backupBeforeMigrate(dbPath, path.join(dir, 'backups'), compat);
    expect(backup).toBeNull();
  });

  it('backupBeforeMigrate is a no-op when already at the latest version', async () => {
    const { dbPath, dir } = await scratchDbPath();
    const log = openEventLog(dbPath);
    log.close();
    const compat = await checkSchemaCompatibility(dbPath);
    const backup = await backupBeforeMigrate(dbPath, path.join(dir, 'backups'), compat);
    expect(backup).toBeNull();
  });

  it('backupBeforeMigrate copies the db before a pending migration runs', async () => {
    const { dbPath, dir } = await scratchDbPath();
    const log = openEventLog(dbPath);
    const priorVersion = latestKnownSchemaVersion() - 1;
    expect(priorVersion).toBeGreaterThanOrEqual(1);
    log.db.pragma(`user_version = ${priorVersion}`);
    log.close();

    const backupsDir = path.join(dir, 'backups');
    const compat = await checkSchemaCompatibility(dbPath);
    expect(compat.compatible).toBe(true);
    expect(compat.dbVersion).toBeLessThan(compat.latestVersion);

    const backupPath = await backupBeforeMigrate(
      dbPath,
      backupsDir,
      compat,
      () => '2026-07-21T00:00:00.000Z',
    );
    expect(backupPath).not.toBeNull();
    expect(backupPath).toContain(`state-v${priorVersion}-`);
    const original = await fs.readFile(dbPath);
    const copied = await fs.readFile(backupPath as string);
    expect(copied).toEqual(original);
  });
});
