/**
 * projects/stats.ts — the DB-derived half of a project card.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import path from 'node:path';
import { openEventLogReader, type EventLog } from '@dokima/events';
import { computeBoard, listTickets } from '@dokima/tickets';
import { STATE_DB_RELATIVE, type ProjectCard, type ProjectRecord } from './types.js';
import { pathExists } from './registry-store.js';

/** The DB-derived half of a card. `available` is a filesystem fact, not a stat, so it is deliberately not part of this shape. */
export type ProjectStats = Omit<ProjectCard, keyof ProjectRecord | 'available'>;

export const EMPTY_STATS: ProjectStats = {
  phase: null,
  board: { ready: 0, blocked: 0, done: 0 },
  berthsRunning: 0,
  heartbeatAgeMs: null,
  pendingDecideCount: 0,
  spendTodayUsd: 0,
};

/**
 * `openEventLogReader` opens read-only (DATABASE.md §7 note above) and never runs
 * migrations, so a `state.db` left on an older schema throws better-sqlite3's
 * `SQLITE_ERROR: no such table/column: ...` — the one case this function is
 * documented to degrade for. Anything else (corruption, a real bug in
 * computeBoard/listTickets, disk I/O failure) must not be swallowed silently.
 */
export function isUnmigratedSchemaError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'SQLITE_ERROR' &&
    /no such table|no such column/.test(err.message)
  );
}

/** Reads live stats straight from the project's own `state.db` — never cached (DATABASE.md §7). */
export async function computeProjectStats(projectPath: string): Promise<ProjectStats> {
  const dbPath = path.join(projectPath, STATE_DB_RELATIVE);
  if (!(await pathExists(dbPath))) return EMPTY_STATS;

  // The open itself throws on an unreadable file (verified: chmod 000 →
  // SQLITE_CANTOPEN at `new Database`, before any query) — it must degrade
  // to EMPTY_STATS like every other failure here, never crash the Fleet
  // endpoint (FR-F1).
  let db: ReturnType<typeof openEventLogReader>;
  try {
    db = openEventLogReader(dbPath);
  } catch (err) {
    console.error(`[fleet] computeProjectStats open failed for ${dbPath}:`, err);
    return EMPTY_STATS;
  }
  try {
    const log: EventLog = { db, path: dbPath, close: () => db.close() };
    const board = computeBoard(listTickets(log));
    const stats = { ready: 0, blocked: 0, done: 0 };
    for (const entry of board) {
      if (entry.status === 'ready') stats.ready += 1;
      else if (entry.status === 'blocked') stats.blocked += 1;
      else if (entry.status === 'done') stats.done += 1;
    }
    return { ...EMPTY_STATS, board: stats };
  } catch (err) {
    if (!isUnmigratedSchemaError(err)) {
      console.error(`[fleet] computeProjectStats failed for ${dbPath}:`, err);
    }
    return EMPTY_STATS;
  } finally {
    db.close();
  }
}

