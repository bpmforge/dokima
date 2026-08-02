import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openGlobalDb } from './db.js';
import { registerProject } from './projects.js';

async function tempDbPath(): Promise<{ dbPath: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dokima-global-db-writer-test-'),
  );
  return {
    dbPath: path.join(dir, 'global.db'),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe('global.db single-writer discipline (C6, same as a project state.db)', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('a second connection writing while the first holds the write lock fails immediately, not after a retry delay', async () => {
    const t = await tempDbPath();
    cleanup = t.cleanup;
    const writerA = openGlobalDb(t.dbPath);
    writerA.db.exec('BEGIN IMMEDIATE');

    const writerB = openGlobalDb(t.dbPath);
    const start = Date.now();
    let thrown: unknown;
    try {
      registerProject(writerB, { id: 'p1', path: '/tmp/p1', name: 'P1' });
    } catch (err) {
      thrown = err;
    }
    const elapsedMs = Date.now() - start;

    expect(thrown).toBeInstanceOf(Database.SqliteError);
    expect((thrown as InstanceType<typeof Database.SqliteError>).code).toMatch(/BUSY/);
    expect(elapsedMs).toBeLessThan(500);

    writerA.db.exec('ROLLBACK');
    writerA.close();
    writerB.close();
  });

  it('a second writer succeeds once the first releases the lock', async () => {
    const t = await tempDbPath();
    cleanup = t.cleanup;
    const writerA = openGlobalDb(t.dbPath);
    registerProject(writerA, { id: 'p1', path: '/tmp/p1', name: 'P1' });
    writerA.close();

    const writerB = openGlobalDb(t.dbPath);
    const record = registerProject(writerB, { id: 'p2', path: '/tmp/p2', name: 'P2' });
    expect(record.id).toBe('p2');
    writerB.close();
  });
});
