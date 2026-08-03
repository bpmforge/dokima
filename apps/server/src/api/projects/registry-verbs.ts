/**
 * projects/registry-verbs.ts — register / archive / remove. These mutate the fleet registry FILE, not ticket or phase event-log state, so Law 4’s receipt boundary does not apply.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { randomUUID } from 'node:crypto';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ProjectDirectoryError,
  ProjectNotFoundError,
  type ProjectMode,
  type ProjectRecord,
} from './types.js';
import { loadRegistry, saveRegistry, ensureStateDb, pathExists } from './registry-store.js';

export interface RegisterProjectInput {
  path: string;
  name?: string;
  mode: ProjectMode;
}

/**
 * Registers, imports, or reopens a project directory (FR-F1/F2). Reopening
 * an archived project is the same call on the same path (UX_SPEC §2
 * "Un-archive"): the existing record is reactivated in place, never
 * duplicated.
 */
export async function registerProject(
  registryPath: string,
  input: RegisterProjectInput,
  now: () => string = () => new Date().toISOString(),
): Promise<ProjectRecord> {
  const absPath = path.resolve(input.path);

  if (input.mode === 'new') {
    await fs.mkdir(absPath, { recursive: true });
  } else if (!(await pathExists(absPath))) {
    const label = input.mode === 'onboard' ? 'Onboard' : 'Import';
    throw new ProjectDirectoryError(
      `${label} requires an existing directory: ${absPath}`,
    );
  }

  await ensureStateDb(absPath);

  const records = await loadRegistry(registryPath);
  const nowIso = now();
  const existing = records.find((record) => record.path === absPath);
  let record: ProjectRecord;
  if (existing) {
    existing.archived = false;
    existing.lastOpenedAt = nowIso;
    record = existing;
  } else {
    record = {
      id: randomUUID(),
      path: absPath,
      name: input.name?.trim() || path.basename(absPath),
      archived: false,
      createdAt: nowIso,
      lastOpenedAt: nowIso,
    };
    records.push(record);
  }
  await saveRegistry(registryPath, records);
  return record;
}

/** Closes the folder (FR-F2): flips the registry flag only, never touches the project directory. */
export async function archiveProject(
  registryPath: string,
  id: string,
): Promise<ProjectRecord> {
  const records = await loadRegistry(registryPath);
  const record = records.find((r) => r.id === id);
  if (!record) throw new ProjectNotFoundError(`no project registered with id ${id}`);
  record.archived = true;
  await saveRegistry(registryPath, records);
  return record;
}

/**
 * Forgets a registry entry (W9-15). Registry-only by construction: this
 * function has no filesystem write path other than `saveRegistry`, so it
 * cannot delete the user's repo or its `.dokima/state.db` — the sharp edge
 * this ticket exists to avoid. Re-registering the same path later is the
 * normal `registerProject` call and restores the project.
 */
export async function removeProject(
  registryPath: string,
  id: string,
): Promise<ProjectRecord> {
  const records = await loadRegistry(registryPath);
  const record = records.find((r) => r.id === id);
  if (!record) throw new ProjectNotFoundError(`no project registered with id ${id}`);
  await saveRegistry(
    registryPath,
    records.filter((r) => r.id !== id),
  );
  return record;
}

