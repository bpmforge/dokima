/**
 * Playbook store (DATABASE.md §5, BLUEPRINT §3.8, FR-M2): ACE-style entries,
 * delta-edited never replaced (distill-never-replay), verified-before-stored
 * (only tool/challenger-confirmed outcomes enter — unlike `store/facts.ts`'s
 * `insertFact`, there is no "insert unverified, flip later" path here: the
 * DB CHECK constraint (010_playbook.sql) and `insertPlaybookEntry` both
 * refuse any `verifiedBy` other than 'tool'/'challenger', so an unconfirmed
 * lesson is rejected at store, not merely hidden from recall).
 *
 * "Delta-edit-only" is a single write path, not a policy convention:
 * `insertPlaybookEntry` never mutates a prior row's `entry` text — a repeat
 * call for the same `taskClass` retires the current head (`retired_at` only)
 * and appends a new row (`version` + 1, `delta_of` -> the retired row's id).
 * There is no update-in-place API in this module.
 */
import type { SqliteHandle } from '../store/handle.js';

export type PlaybookVerifiedBy = 'tool' | 'challenger';

export interface PlaybookEntryRecord {
  readonly id: number;
  readonly taskClass: string;
  readonly entry: string;
  readonly version: number;
  readonly verifiedBy: PlaybookVerifiedBy;
  readonly deltaOf: number | null;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

export interface InsertPlaybookEntryInput {
  readonly taskClass: string;
  readonly entry: string;
  /** Only a tool run or a challenger judgment may confirm a playbook lesson (FR-M2) — never the authoring session's own say-so. */
  readonly verifiedBy: PlaybookVerifiedBy;
}

/** Thrown when a caller tries to store a playbook entry without a tool/challenger confirmation (FR-M2: "unconfirmed lesson rejected at store"). */
export class UnconfirmedPlaybookEntryError extends Error {
  constructor(public readonly verifiedBy: unknown) {
    super(
      `playbook entries must be tool/challenger-confirmed to be stored (FR-M2) — ` +
        `got verifiedBy=${JSON.stringify(verifiedBy)}`,
    );
    this.name = 'UnconfirmedPlaybookEntryError';
  }
}

interface PlaybookRow {
  id: number;
  task_class: string;
  entry: string;
  version: number;
  verified_by: string;
  delta_of: number | null;
  created_at: string;
  retired_at: string | null;
}

function toRecord(row: PlaybookRow): PlaybookEntryRecord {
  return {
    id: row.id,
    taskClass: row.task_class,
    entry: row.entry,
    version: row.version,
    verifiedBy: row.verified_by as PlaybookVerifiedBy,
    deltaOf: row.delta_of,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
  };
}

function assertVerified(verifiedBy: unknown): asserts verifiedBy is PlaybookVerifiedBy {
  if (verifiedBy !== 'tool' && verifiedBy !== 'challenger') {
    throw new UnconfirmedPlaybookEntryError(verifiedBy);
  }
}

/** The current live (non-retired) entry for a task class — the R0 lookup path (DATABASE.md §5 index). */
export function getPlaybookHead(
  handle: SqliteHandle,
  taskClass: string,
): PlaybookEntryRecord | undefined {
  const row = handle
    .prepare<PlaybookRow>(
      `SELECT * FROM playbook WHERE task_class = ? AND retired_at IS NULL
       ORDER BY version DESC LIMIT 1`,
    )
    .get(taskClass);
  return row ? toRecord(row) : undefined;
}

export function getPlaybookEntryById(
  handle: SqliteHandle,
  id: number,
): PlaybookEntryRecord | undefined {
  const row = handle.prepare<PlaybookRow>('SELECT * FROM playbook WHERE id = ?').get(id);
  return row ? toRecord(row) : undefined;
}

/** Every version ever recorded for a task class, retired or not — the full delta chain, never deleted. */
export function listPlaybookHistory(
  handle: SqliteHandle,
  taskClass: string,
): PlaybookEntryRecord[] {
  const rows = handle
    .prepare<PlaybookRow>(
      'SELECT * FROM playbook WHERE task_class = ? ORDER BY version ASC',
    )
    .all(taskClass);
  return rows.map(toRecord);
}

/**
 * Records a confirmed playbook lesson. Throws `UnconfirmedPlaybookEntryError`
 * for any `verifiedBy` other than 'tool'/'challenger' — the only rejection
 * path FR-M2 requires, checked at runtime (not just the TS type) so a caller
 * that bypasses the type system still can't smuggle an unconfirmed entry in.
 * First call for a `taskClass` creates version 1 (`deltaOf: null`); every
 * later call retires the current head and appends the next version as a
 * delta of it — the entry text of a retired row is never rewritten.
 */
export function insertPlaybookEntry(
  handle: SqliteHandle,
  input: InsertPlaybookEntryInput,
  now: () => string,
): PlaybookEntryRecord {
  assertVerified(input.verifiedBy);
  const createdAt = now();
  const taskClass = normalizePlaybookTaskClass(input.taskClass);
  const head = getPlaybookHead(handle, taskClass);
  if (head) {
    handle
      .prepare('UPDATE playbook SET retired_at = ? WHERE id = ?')
      .run(createdAt, head.id);
  }
  const version = head ? head.version + 1 : 1;
  const deltaOf = head ? head.id : null;
  const result = handle
    .prepare(
      `INSERT INTO playbook (task_class, entry, version, verified_by, delta_of, created_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(taskClass, input.entry, version, input.verifiedBy, deltaOf, createdAt);
  return getPlaybookEntryById(
    handle,
    Number(result.lastInsertRowid),
  ) as PlaybookEntryRecord;
}

/** Normalizes a criterion string into a task-class lookup key — exact-match fixture recurrence, never fuzzy (R0 must never fabricate a match it can't ground). */
export function normalizePlaybookTaskClass(criterion: string): string {
  return criterion.trim().toLowerCase().replace(/\s+/g, ' ');
}
