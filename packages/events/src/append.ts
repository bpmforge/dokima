import { redactDeep } from '@shipwright/shared';
import { computeEventHash, GENESIS_HASH, type ChainRow } from './hash.js';
import type { EventInput, EventLog, EventRecord } from './types.js';

interface EventRow {
  seq: number;
  event_type: string;
  actor_id: string;
  ticket_id: string | null;
  run_id: string | null;
  payload: string;
  created_at: string;
  prev_hash: string;
  hash: string;
}

function rowToRecord(row: EventRow): EventRecord {
  return {
    seq: row.seq,
    eventType: row.event_type,
    actorId: row.actor_id,
    ticketId: row.ticket_id,
    runId: row.run_id,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

export interface AppendEventOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
  /**
   * Extra secret values to redact beyond known live-credential shapes
   * (SC-06) — typically the result of `collectSecretValues(vault,
   * projectDir)` (`@shipwright/shared`), gathered by the caller since
   * collecting them is async while `appendEvent` must stay sync (it runs
   * inside a single better-sqlite3 transaction). Omit to still get
   * pattern-based redaction only.
   */
  secretValues?: readonly string[];
}

/**
 * Appends one event inside a single transaction: seq is assigned as
 * `MAX(seq)+1` and prev_hash read from the current tail row within the same
 * transaction, so there is no window between the check and the insert
 * (single-writer, DATABASE.md §1) — no AUTOINCREMENT-then-update, which the
 * append-only trigger would reject anyway.
 *
 * `input.payload` is redacted (SC-06, `redactDeep`) before it is
 * JSON-stringified, hashed, or persisted — this is the universal choke
 * point for the event log, so no secret from any producer ever reaches the
 * hash-chained `events` table (NFR-4). The redacted payload is what gets
 * hashed and stored, so the returned record's hash always matches its own
 * payload; the returned record's `payload` field is the redacted value too,
 * never the raw input.
 */
export function appendEvent(
  log: EventLog,
  input: EventInput,
  opts: AppendEventOptions = {},
): EventRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  const secretValues = opts.secretValues ?? [];
  const run = log.db.transaction((): EventRecord => {
    const tail = log.db
      .prepare<[], { seq: number; hash: string }>(
        'SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1',
      )
      .get();
    const seq = (tail?.seq ?? 0) + 1;
    const prevHash = tail?.hash ?? GENESIS_HASH;
    const payload = redactDeep(input.payload ?? null, secretValues);
    const payloadJson = JSON.stringify(payload);
    const hash = computeEventHash({
      prevHash,
      seq,
      eventType: input.eventType,
      actorId: input.actorId,
      payloadJson,
    });
    const createdAt = now();
    const ticketId = input.ticketId ?? null;
    const runId = input.runId ?? null;
    log.db
      .prepare(
        `INSERT INTO events (seq, event_type, actor_id, ticket_id, run_id, payload, created_at, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq,
        input.eventType,
        input.actorId,
        ticketId,
        runId,
        payloadJson,
        createdAt,
        prevHash,
        hash,
      );
    return {
      seq,
      eventType: input.eventType,
      actorId: input.actorId,
      ticketId,
      runId,
      payload,
      createdAt,
      prevHash,
      hash,
    };
  });
  return run();
}

export function listEvents(log: EventLog): EventRecord[] {
  return log.db
    .prepare<[], EventRow>('SELECT * FROM events ORDER BY seq ASC')
    .all()
    .map(rowToRecord);
}

/** Raw rows (payload as stored text, not parsed) for feeding `verifyChain`. */
export function listChainRows(log: EventLog): ChainRow[] {
  return log.db
    .prepare<[], EventRow>('SELECT * FROM events ORDER BY seq ASC')
    .all()
    .map((row) => ({
      seq: row.seq,
      eventType: row.event_type,
      actorId: row.actor_id,
      payloadJson: row.payload,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
}
