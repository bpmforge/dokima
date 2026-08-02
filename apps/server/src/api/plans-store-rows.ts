/**
 * `plan_items` SQL row <-> `PlanItemRecord`/`PlanItemRow` mapping + the
 * short-lived-writer connection helper. Split out of `plans-store.ts`
 * (validate-file-size.sh's 400-line book cap, G-A) — this is the "chapter"
 * that never needs the engine imports, only the table shape.
 */

import { promises as fsPromises, readFileSync } from 'node:fs';
import path from 'node:path';
import { distributionRoot } from '@dokima/shared';
import { openEventLog, type EventLog } from '@dokima/events';
import {
  CATALOG_CONTENT_PATH,
  parseCatalog,
  type PlanItemRecord,
} from '@dokima/pipeline';
import { stateDbPath } from './server/settings-db.js';
import type { PlanItemRow } from './plans-types.js';

// Anchored to the distribution root rather than counting '..' hops, which a
// bundle invalidates (W9-13).
const REPO_ROOT = distributionRoot();

export function loadCatalogEntries(): ReturnType<typeof parseCatalog> {
  const raw = readFileSync(path.join(REPO_ROOT, CATALOG_CONTENT_PATH), 'utf8');
  return parseCatalog(raw);
}

export interface PlanItemSqlRow {
  id: string;
  catalog_id: string;
  rank: number;
  state: string;
  ticket_id: string | null;
  verify_criterion: string;
  recommendation: string;
  severity: number;
  leverage: number;
  last_verified_at: string | null;
  evidence: string;
  created_at: string;
  first_seen_at: string;
  attempt: number;
  dismissed_at: string | null;
  dismissed_reason: string | null;
}

export const SELECT_ALL = 'SELECT * FROM plan_items';
export const SELECT_ONE = 'SELECT * FROM plan_items WHERE id = ?';
export const VERIFIABLE_STATES = "('accepted','in_progress','done')";

export function fromSqlRow(row: PlanItemSqlRow): PlanItemRow {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    rank: row.rank,
    state: row.state as PlanItemRow['state'],
    ticketId: row.ticket_id,
    verifyCriterion: row.verify_criterion,
    recommendation: row.recommendation,
    severity: row.severity,
    leverage: row.leverage,
    lastVerifiedAt: row.last_verified_at,
    evidence: JSON.parse(row.evidence) as Record<string, unknown>,
    createdAt: row.created_at,
    firstSeenAt: row.first_seen_at,
    attempt: row.attempt,
    dismissedAt: row.dismissed_at,
    dismissedReason: row.dismissed_reason,
  };
}

export function toRecord(row: PlanItemRow): PlanItemRecord {
  return {
    id: row.id,
    catalogId: row.catalogId,
    rank: row.rank,
    state: row.state,
    ticketId: row.ticketId,
    verifyCriterion: row.verifyCriterion,
    recommendation: row.recommendation,
    severity: row.severity,
    leverage: row.leverage,
    lastVerifiedAt: row.lastVerifiedAt,
    evidence: row.evidence,
    createdAt: row.createdAt,
    firstSeenAt: row.firstSeenAt,
    attempt: row.attempt,
  };
}

export function toRow(record: PlanItemRecord): PlanItemRow {
  return { ...record, dismissedAt: null, dismissedReason: null };
}

export function insertRow(db: EventLog['db'], record: PlanItemRecord): void {
  db.prepare(
    `INSERT INTO plan_items
       (id, catalog_id, rank, state, ticket_id, verify_criterion, recommendation,
        severity, leverage, last_verified_at, evidence, created_at, first_seen_at, attempt)
     VALUES (@id, @catalogId, @rank, @state, @ticketId, @verifyCriterion, @recommendation,
        @severity, @leverage, @lastVerifiedAt, @evidence, @createdAt, @firstSeenAt, @attempt)`,
  ).run({
    id: record.id,
    catalogId: record.catalogId,
    rank: record.rank,
    state: record.state,
    ticketId: record.ticketId,
    verifyCriterion: record.verifyCriterion,
    recommendation: record.recommendation,
    severity: record.severity,
    leverage: record.leverage,
    lastVerifiedAt: record.lastVerifiedAt,
    evidence: JSON.stringify(record.evidence ?? {}),
    createdAt: record.createdAt,
    firstSeenAt: record.firstSeenAt,
    attempt: record.attempt,
  });
}

export function updateRow(db: EventLog['db'], record: PlanItemRecord): void {
  db.prepare(
    `UPDATE plan_items
       SET state = @state, ticket_id = @ticketId, last_verified_at = @lastVerifiedAt,
           evidence = @evidence, attempt = @attempt, rank = @rank
       WHERE id = @id`,
  ).run({
    id: record.id,
    state: record.state,
    ticketId: record.ticketId,
    lastVerifiedAt: record.lastVerifiedAt,
    evidence: JSON.stringify(record.evidence ?? {}),
    attempt: record.attempt,
    rank: record.rank,
  });
}

/** Opens `{project}/.dokima/state.db` briefly (applying pending migrations), runs `fn` in a transaction, closes. */
export async function withPlanWriter<T>(
  projectPath: string,
  fn: (log: EventLog) => T,
): Promise<T> {
  const dbPath = stateDbPath(projectPath);
  await fsPromises.mkdir(path.dirname(dbPath), { recursive: true });
  const log = openEventLog(dbPath);
  try {
    return log.db.transaction((): T => fn(log))();
  } finally {
    log.close();
  }
}
