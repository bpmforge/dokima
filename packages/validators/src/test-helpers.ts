import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempDb {
  dbPath: string;
  cleanup: () => Promise<void>;
}

/** A throwaway file path (not yet created) for a WAL-mode SQLite fixture. */
export async function createTempDbPath(): Promise<TempDb> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-validators-test-'));
  return {
    dbPath: path.join(dir, 'state.db'),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

export interface TempDir {
  dir: string;
  cleanup: () => Promise<void>;
}

/** A throwaway directory for fixture projects / fixture validator scripts. */
export async function createTempDir(prefix: string): Promise<TempDir> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), `shipwright-validators-${prefix}-`),
  );
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** Writes an executable script (shebang included) to `dir/name`, returning its path. */
export async function writeScript(
  dir: string,
  name: string,
  contents: string,
): Promise<string> {
  const scriptPath = path.join(dir, name);
  await fs.writeFile(scriptPath, contents, { mode: 0o755 });
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}
