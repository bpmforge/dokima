import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultGlobalDbPath, openGlobalDb, openGlobalDbReader } from './db.js';

async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-global-db-test-'));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

const TABLE_NAMES = ['projects', 'providers', 'global_playbook', 'model_fitness'];

describe('openGlobalDb', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('enables WAL mode and foreign keys', async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    const global = openGlobalDb(path.join(t.dir, 'global.db'));
    expect(global.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(global.db.pragma('foreign_keys', { simple: true })).toBe(1);
    global.close();
  });

  it('creates its own parent directory (unlike openEventLog)', async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    const dbPath = path.join(t.dir, 'nested', 'deeper', 'global.db');
    const global = openGlobalDb(dbPath);
    expect(global.path).toBe(dbPath);
    global.close();
  });

  it('applies migrations, creating the four DATABASE.md §7 tables', async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    const global = openGlobalDb(path.join(t.dir, 'global.db'));
    const tables = global.db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(TABLE_NAMES));
    expect(global.db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
    global.close();
  });

  it('is idempotent across repeated opens of the same file', async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    const dbPath = path.join(t.dir, 'global.db');
    const first = openGlobalDb(dbPath);
    first.close();
    const second = openGlobalDb(dbPath);
    expect(second.db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
    second.close();
  });

  it('defaultGlobalDbPath resolves under SHIPWRIGHT_HOME', () => {
    expect(defaultGlobalDbPath({ SHIPWRIGHT_HOME: '/tmp/fake-home' })).toBe(
      path.join('/tmp/fake-home', 'global.db'),
    );
  });

  it('openGlobalDbReader opens read-only without applying migrations', async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    const dbPath = path.join(t.dir, 'global.db');
    openGlobalDb(dbPath).close();
    const reader = openGlobalDbReader(dbPath);
    expect(() =>
      reader
        .prepare(
          "INSERT INTO providers (id, kind, status, created_at) VALUES ('a', 'b', 'c', 'd')",
        )
        .run(),
    ).toThrow(/readonly/i);
    reader.close();
  });
});
