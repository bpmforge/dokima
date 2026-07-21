/**
 * Config-dir + env-var contract for the packaged runtime (DEPLOYMENT.md §2/§6).
 * `SHIPWRIGHT_HOME` relocation already lives in `@shipwright/shared`
 * (`computeShipwrightHome`, used by the token/settings paths since W4-01) —
 * reused here rather than re-implemented so the whole runtime agrees on one
 * home directory.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeShipwrightHome, PROJECT_SETTINGS_DIRNAME } from '@shipwright/shared';

export const HOME_DIR_MODE = 0o700;
export const PACKS_DIRNAME = 'packs';
export const BACKUPS_DIRNAME = 'backups';
export const WORKTREES_DIRNAME = 'worktrees';

export type LogLevel = 'info' | 'debug';
const VALID_LOG_LEVELS: readonly LogLevel[] = ['info', 'debug'];

/** `SHIPWRIGHT_LOG_LEVEL` — `info` default; unrecognized values fall back to `info` (DEPLOYMENT.md §6). */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env.SHIPWRIGHT_LOG_LEVEL;
  return (VALID_LOG_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as LogLevel)
    : 'info';
}

export interface ProjectPaths {
  projectDir: string;
  shipwrightDir: string;
  dbPath: string;
  backupsDir: string;
  worktreesDir: string;
}

export function resolveProjectPaths(projectDir: string): ProjectPaths {
  const shipwrightDir = path.join(projectDir, PROJECT_SETTINGS_DIRNAME);
  return {
    projectDir,
    shipwrightDir,
    dbPath: path.join(shipwrightDir, 'state.db'),
    backupsDir: path.join(shipwrightDir, BACKUPS_DIRNAME),
    worktreesDir: path.join(shipwrightDir, WORKTREES_DIRNAME),
  };
}

export interface HomePaths {
  home: string;
  packsDir: string;
}

export function resolveHomePaths(env: NodeJS.ProcessEnv = process.env): HomePaths {
  const home = computeShipwrightHome(env);
  return { home, packsDir: path.join(home, PACKS_DIRNAME) };
}

async function ensureDir(dir: string, mode?: number): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if (mode !== undefined) await fs.chmod(dir, mode);
}

/**
 * Creates `~/.shipwright/` (+ `packs/`) and `<project>/.shipwright/`
 * (+ `backups/`, `worktrees/`), all mode 0700 (DEPLOYMENT.md §2, SC-08's
 * "`~/.shipwright/` and `.shipwright/` are created 0700" precedent from
 * the token path).
 */
export async function ensureConfigDirs(
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ home: HomePaths; project: ProjectPaths }> {
  const home = resolveHomePaths(env);
  const project = resolveProjectPaths(projectDir);
  await ensureDir(home.home, HOME_DIR_MODE);
  await ensureDir(home.packsDir, HOME_DIR_MODE);
  await ensureDir(project.shipwrightDir, HOME_DIR_MODE);
  await ensureDir(project.backupsDir, HOME_DIR_MODE);
  await ensureDir(project.worktreesDir, HOME_DIR_MODE);
  return { home, project };
}
