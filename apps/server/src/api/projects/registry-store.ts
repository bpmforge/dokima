/**
 * projects/registry-store.ts — reading and writing the fleet registry file.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeDokimaHome } from '@dokima/shared';
import { openEventLog } from '@dokima/events';
import { STATE_DB_RELATIVE, FLEET_REGISTRY_FILENAME, type ProjectRecord } from './types.js';

export function computeFleetRegistryPath(home: string = computeDokimaHome()): string {
  return path.join(home, FLEET_REGISTRY_FILENAME);
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function loadRegistry(registryPath: string): Promise<ProjectRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as ProjectRecord[]) : [];
}

export async function saveRegistry(
  registryPath: string,
  records: ProjectRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

/** Ensures `.dokima/state.db` has schema applied, without opening (and thus lock-contending) an existing one. */
export async function ensureStateDb(projectPath: string): Promise<void> {
  const dbPath = path.join(projectPath, STATE_DB_RELATIVE);
  if (await pathExists(dbPath)) return;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  openEventLog(dbPath).close();
}

