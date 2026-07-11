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
}

/**
 * Appends one event inside a single transaction: seq is assigned as
 * `MAX(seq)+1` and prev_hash read from the current tail row within the same
 * transaction, so there is no window between the check and the insert
 * (single-writer, DATABASE.md §1) — no AUTOINCREMENT-then-update, which the
 * append-only trigger would reject anyway.
 */
export function appendEvent(
  log: EventLog,
  input: EventInput,
  opts: AppendEventOptions = {},
): EventRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  const run = log.db.transaction((): EventRecord => {
    const tail = log.db
      .prepare<[], { seq: number; hash: string }>(
        'SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1',
      )
      .get();
    const seq = (tail?.seq ?? 0) + 1;
    const prevHash = tail?.hash ?? GENESIS_HASH;
    const payloadJson = JSON.stringify(input.payload ?? null);
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
      payload: input.payload ?? null,
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
