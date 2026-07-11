import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempDb {
  dbPath: string;
  cleanup: () => Promise<void>;
}

/** A throwaway file path (not yet created) for a WAL-mode SQLite fixture. */
export async function createTempDbPath(): Promise<TempDb> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-tickets-test-'));
  return {
    dbPath: path.join(dir, 'state.db'),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
