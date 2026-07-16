/**
 * Fitness cards for the roster (SRS FR-E2 "fitness cards per configured
 * model (W2-08)"). `@shipwright/events`'s global-db module already carries
 * `listModelFitness` over `~/.shipwright/global.db` (W4-09) — this just
 * reads it read-only and filters to one role, degrading to an empty list
 * the same way `projects.ts`'s `computeProjectStats` degrades on a missing
 * or unreadable db (never crash the roster endpoint over bench data that
 * simply hasn't been produced yet for this role).
 */

import { promises as fs } from 'node:fs';
import {
  defaultGlobalDbPath,
  listModelFitness,
  openGlobalDbReader,
  type ModelFitnessRecord,
} from '@shipwright/events';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export interface LoadFitnessCardsOptions {
  /** Overrides `defaultGlobalDbPath()` — tests only. */
  globalDbPath?: string;
}

/** All fitness cards recorded for `role`, across every benched model. Empty when no bench data exists yet. */
export async function loadFitnessCards(
  role: string,
  opts: LoadFitnessCardsOptions = {},
): Promise<ModelFitnessRecord[]> {
  const dbPath = opts.globalDbPath ?? defaultGlobalDbPath();
  if (!(await pathExists(dbPath))) return [];

  let db: ReturnType<typeof openGlobalDbReader>;
  try {
    db = openGlobalDbReader(dbPath);
  } catch (err) {
    console.error(`[roster] fitness card open failed for ${dbPath}:`, err);
    return [];
  }
  try {
    return listModelFitness({ db, path: dbPath, close: () => db.close() }).filter(
      (card) => card.role === role,
    );
  } catch (err) {
    console.error(`[roster] fitness card read failed for ${dbPath}:`, err);
    return [];
  } finally {
    db.close();
  }
}
