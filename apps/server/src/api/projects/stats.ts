/**
 * projects/stats.ts — the DB-derived half of a project card.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import path from 'node:path';
import { listEvents, openEventLogReader, type EventLog } from '@dokima/events';
import { computeBoard, listTickets } from '@dokima/tickets';
import { listSlates } from '../decisions/store.js';
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

/**
 * Open founder/technical slates — the same rows `GET /projects/:id/slates?status=open`
 * serves the Decisions board, counted rather than listed.
 *
 * Degrades to 0 rather than throwing: a project whose `decisions` table
 * predates the slate migration is a normal older project, not a broken one,
 * and a Fleet card must never fail to render over a count.
 */
function countOpenSlates(log: EventLog): number {
  try {
    return listSlates(log, { status: 'open' }).length;
  } catch (err) {
    if (!isUnmigratedSchemaError(err)) {
      console.error(`[fleet] countOpenSlates failed for ${log.path}:`, err);
    }
    return 0;
  }
}

/**
 * Today's spend, summed from the durable `spend.recorded` events (W13-24).
 *
 * Before this the column was a hardcoded 0 that the Fleet rendered as though
 * it were measured — the same shape of defect W10-73 found in
 * `pendingDecideCount`, on the field right beside it.
 *
 * "Today" is the LOCAL calendar day, not a rolling 24h: the column is read by
 * a person asking "what has this cost me today", and a rolling window answers
 * a question nobody asked.
 */
/**
 * W19-01: the phase column comes alive. `phase.advanced` is appended only by
 * the auto gate after a verified receipt (run-phase-progress.ts), so this
 * projection is receipt-backed by construction. No event -> phase 0 has not
 * been cleared yet -> the card's `null` ("Not started") stays honest.
 */
export function latestAdvancedPhase(log: EventLog): number | null {
  let phase: number | null = null;
  for (const event of listEvents(log)) {
    if (event.eventType !== 'phase.advanced') continue;
    const to = (event.payload as { to?: unknown } | null)?.to;
    if (typeof to === 'number') phase = to;
  }
  return phase;
}

export function sumSpendToday(log: EventLog, now: () => Date = () => new Date()): number {
  const startOfDay = new Date(now());
  startOfDay.setHours(0, 0, 0, 0);
  const since = startOfDay.toISOString();
  let total = 0;
  for (const event of listEvents(log)) {
    if (event.eventType !== 'spend.recorded') continue;
    if (event.createdAt < since) continue;
    const cost = (event.payload as { costUsd?: unknown }).costUsd;
    if (typeof cost === 'number' && Number.isFinite(cost)) total += cost;
  }
  return total;
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
    // W10-73: the one number on this card whose whole job is "does this need
    // you". It was a hardcoded 0 in EMPTY_STATS and computed nowhere, so a
    // project with a run paused on two founder decisions reported 0 — and the
    // Fleet SORTS by this field, so the project that most needed attention
    // sank to the bottom of the list instead of rising to the top.
    //
    // `berthsRunning` and `heartbeatAgeMs` are still the constants they always
    // were. `spendTodayUsd` no longer is (W13-24) — it had the same defect
    // W10-73 fixed above, a hardcoded 0 the Fleet displays as though measured.
    return {
      ...EMPTY_STATS,
      phase: latestAdvancedPhase(log),
      board: stats,
      pendingDecideCount: countOpenSlates(log),
      spendTodayUsd: sumSpendToday(log),
    };
  } catch (err) {
    if (!isUnmigratedSchemaError(err)) {
      console.error(`[fleet] computeProjectStats failed for ${dbPath}:`, err);
    }
    return EMPTY_STATS;
  } finally {
    db.close();
  }
}

