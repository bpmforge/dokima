/**
 * projects/cards.ts — assembling registry records into cards for the Fleet view.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { EMPTY_STATS } from './stats.js';

import { ProjectCard, ProjectRecord } from './types.js';
import { loadRegistry, pathExists } from './registry-store.js';
import { computeProjectStats } from './stats.js';

export async function toCard(record: ProjectRecord): Promise<ProjectCard> {
  const available = await pathExists(record.path);
  // Don't even probe the DB for a directory that isn't there — the stats would
  // be zeros either way, and `available: false` is what makes those zeros
  // readable as "gone" rather than "empty".
  if (!available) return { ...record, ...EMPTY_STATS, available };
  return { ...record, ...(await computeProjectStats(record.path)), available };
}

export async function listProjectCards(
  registryPath: string,
  filter: { archived: boolean } = { archived: false },
): Promise<ProjectCard[]> {
  const records = await loadRegistry(registryPath);
  const filtered = records.filter((r) => r.archived === filter.archived);
  return Promise.all(filtered.map(toCard));
}

export function wireCard(card: ProjectCard) {
  return {
    id: card.id,
    path: card.path,
    name: card.name,
    archived: card.archived,
    available: card.available,
    created_at: card.createdAt,
    // W22-22. Absent for every project registered before the field existed,
    // and absent is the answer — a client must be able to tell "made fresh"
    // from "we do not know how this got here".
    created_mode: card.createdMode ?? null,
    last_opened_at: card.lastOpenedAt,
    phase: card.phase,
    board: card.board,
    berths_running: card.berthsRunning,
    heartbeat_age_ms: card.heartbeatAgeMs,
    pending_decide_count: card.pendingDecideCount,
    spend_today: card.spendTodayUsd,
  };
}

