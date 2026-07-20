/**
 * Long-term memory: facts, error->solution pairs, decision refs, research
 * notes (DATABASE.md §5, FR-M1). "Verified-before-stored"
 * (source-system-foreman-jarvis.md §5): `insertFact` always inserts
 * `verified = 0` — there is no input path to insert an already-verified
 * fact. Only a distinct challenger/tool confirmation call, `markFactVerified`,
 * flips it, and only verified rows are eligible for recall (`searchFacts`,
 * `store/anchor.ts`, `store/retrieval.ts`).
 */
import type { SqliteHandle } from './handle.js';

export type FactKind = 'fact' | 'error_solution' | 'decision_ref' | 'research';

export interface FactRecord {
  readonly id: number;
  readonly kind: FactKind;
  readonly content: string;
  readonly source: string | null;
  readonly confidence: number;
  readonly verified: boolean;
  readonly ticketId: string | null;
  readonly phase: string | null;
  readonly embedding: Buffer | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly useCount: number;
  readonly decayed: boolean;
}

export interface InsertFactInput {
  readonly kind: FactKind;
  readonly content: string;
  readonly source?: string | null;
  readonly confidence: number;
  readonly ticketId?: string | null;
  readonly phase?: string | null;
  readonly embedding?: Buffer | null;
}

interface FactRow {
  id: number;
  kind: string;
  content: string;
  source: string | null;
  confidence: number;
  verified: number;
  ticket_id: string | null;
  phase: string | null;
  embedding: Buffer | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  decayed: number;
}

function toRecord(row: FactRow): FactRecord {
  return {
    id: row.id,
    kind: row.kind as FactKind,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    verified: row.verified === 1,
    ticketId: row.ticket_id,
    phase: row.phase,
    embedding: row.embedding,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    decayed: row.decayed === 1,
  };
}

/**
 * Inserts a fact as unverified — there is no way to insert an already-verified
 * fact. Only `markFactVerified` (a distinct call, made by a challenger/tool
 * confirmation, never the authoring session) can make a fact recall-eligible.
 */
export function insertFact(
  handle: SqliteHandle,
  input: InsertFactInput,
  now: () => string,
): FactRecord {
  const createdAt = now();
  const result = handle
    .prepare(
      `INSERT INTO facts (kind, content, source, confidence, verified, ticket_id, phase, embedding, created_at, last_used_at, use_count, decayed)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, 0, 0)`,
    )
    .run(
      input.kind,
      input.content,
      input.source ?? null,
      input.confidence,
      input.ticketId ?? null,
      input.phase ?? null,
      input.embedding ?? null,
      createdAt,
    );
  return getFact(handle, Number(result.lastInsertRowid)) as FactRecord;
}

export function getFact(handle: SqliteHandle, id: number): FactRecord | undefined {
  const row = handle.prepare<FactRow>('SELECT * FROM facts WHERE id = ?').get(id);
  return row ? toRecord(row) : undefined;
}

/** Verified-before-stored: a challenger/tool confirmation flips this once. */
export function markFactVerified(handle: SqliteHandle, id: number): void {
  handle.prepare('UPDATE facts SET verified = 1 WHERE id = ?').run(id);
}

/** Bumps use_count and last_used_at when a fact is actually recalled into a prompt. */
export function touchFactUsage(
  handle: SqliteHandle,
  id: number,
  now: () => string,
): void {
  handle
    .prepare('UPDATE facts SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
    .run(now(), id);
}

export interface ListFactsFilter {
  readonly kind?: FactKind;
  readonly verifiedOnly?: boolean;
  readonly ticketId?: string;
  readonly includeDecayed?: boolean;
}

export function listFacts(
  handle: SqliteHandle,
  filter: ListFactsFilter = {},
): FactRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) {
    clauses.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.verifiedOnly) {
    clauses.push('verified = 1');
  }
  if (filter.ticketId) {
    clauses.push('ticket_id = ?');
    params.push(filter.ticketId);
  }
  if (!filter.includeDecayed) {
    clauses.push('decayed = 0');
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = handle
    .prepare<FactRow>(`SELECT * FROM facts ${where} ORDER BY id`)
    .all(...params);
  return rows.map(toRecord);
}
