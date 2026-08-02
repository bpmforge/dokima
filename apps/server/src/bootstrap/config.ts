/**
 * Config-dir + env-var contract for the packaged runtime (DEPLOYMENT.md §2/§6).
 * `DOKIMA_HOME` relocation already lives in `@dokima/shared`
 * (`computeDokimaHome`, used by the token/settings paths since W4-01) —
 * reused here rather than re-implemented so the whole runtime agrees on one
 * home directory.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeDokimaHome, PROJECT_SETTINGS_DIRNAME } from '@dokima/shared';

export const HOME_DIR_MODE = 0o700;
export const PACKS_DIRNAME = 'packs';
export const BACKUPS_DIRNAME = 'backups';
export const WORKTREES_DIRNAME = 'worktrees';

export type LogLevel = 'info' | 'debug';
const VALID_LOG_LEVELS: readonly LogLevel[] = ['info', 'debug'];

/** `DOKIMA_LOG_LEVEL` — `info` default; unrecognized values fall back to `info` (DEPLOYMENT.md §6). */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env.DOKIMA_LOG_LEVEL;
  return (VALID_LOG_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as LogLevel)
    : 'info';
}

export interface ProjectPaths {
  projectDir: string;
  dokimaDir: string;
  dbPath: string;
  backupsDir: string;
  worktreesDir: string;
}

export function resolveProjectPaths(projectDir: string): ProjectPaths {
  const dokimaDir = path.join(projectDir, PROJECT_SETTINGS_DIRNAME);
  return {
    projectDir,
    dokimaDir,
    dbPath: path.join(dokimaDir, 'state.db'),
    backupsDir: path.join(dokimaDir, BACKUPS_DIRNAME),
    worktreesDir: path.join(dokimaDir, WORKTREES_DIRNAME),
  };
}

export interface HomePaths {
  home: string;
  packsDir: string;
}

export function resolveHomePaths(env: NodeJS.ProcessEnv = process.env): HomePaths {
  const home = computeDokimaHome(env);
  return { home, packsDir: path.join(home, PACKS_DIRNAME) };
}

async function ensureDir(dir: string, mode?: number): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if (mode !== undefined) await fs.chmod(dir, mode);
}

/**
 * Creates `~/.dokima/` (+ `packs/`) and `<project>/.dokima/`
 * (+ `backups/`, `worktrees/`), all mode 0700 (DEPLOYMENT.md §2, SC-08's
 * "`~/.dokima/` and `.dokima/` are created 0700" precedent from
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
  await ensureDir(project.dokimaDir, HOME_DIR_MODE);
  await ensureDir(project.backupsDir, HOME_DIR_MODE);
  await ensureDir(project.worktreesDir, HOME_DIR_MODE);
  return { home, project };
}
