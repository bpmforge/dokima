import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectRecord } from '../projects.js';

const STATE_DB_RELATIVE = path.join('.shipwright', 'state.db');

/**
 * Board verb routes are keyed only by ticket id (API_DESIGN "tickets —
 * verbs" catalog: `POST /tickets/{id}/claim`, no project segment — the same
 * flat shape the CLI mirrors), so a `?project=` query param is the minimal
 * disambiguator for the one thing the CLI never had to solve: which of N
 * registered projects' `state.db` owns this ticket id (D-013, one core
 * serving N projects). This reads `fleet.json` directly rather than calling
 * `projects.ts`'s exported `listProjectCards` (which also computes full
 * board stats for every registered project — needless work, and a needless
 * open of every other project's `state.db`, on every verb call).
 */
async function loadFleetRegistry(registryPath: string): Promise<ProjectRecord[]> {
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

export async function resolveProjectRecord(
  registryPath: string,
  projectId: string,
): Promise<ProjectRecord | undefined> {
  const records = await loadFleetRegistry(registryPath);
  return records.find((r) => r.id === projectId);
}

export function stateDbPath(projectPath: string): string {
  return path.join(projectPath, STATE_DB_RELATIVE);
}
