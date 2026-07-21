/**
 * Restores a validated bundle into an empty project log, preserving every
 * original `seq`/`prev_hash`/`hash`/`created_at` exactly (a raw restore,
 * not a re-append through `appendEvent` — which would mint fresh seq/hash
 * values from the *current* tail and clock, defeating the whole point of
 * proving the chain survived the round trip).
 *
 * Verifies the chain twice: once over the incoming bundle before writing
 * anything (so a tampered bundle never touches the DB), and once more by
 * reading the freshly-written rows back and re-running `verifyChain` — this
 * catches any transcription bug in the insert path itself, not just a
 * tampered *input*. `verifyChain` itself is `@shipwright/events`'s, already
 * a direct `apps/server` dependency — the single, authoritative
 * implementation of "valid chain" for the operational (SQLite-backed) path.
 */
import {
  getIdentity,
  verifyChain,
  type ChainRow,
  type ChainVerificationResult,
  type EventLog,
} from '@shipwright/events';
import {
  ChainVerificationFailedError,
  NonEmptyImportTargetError,
  type EventRow,
  type ExportBundle,
} from './export-bundle-types.js';

export interface ImportResult {
  identitiesImported: number;
  eventsImported: number;
  receiptsImported: number;
  chain: ChainVerificationResult;
}

export function importExportBundle(log: EventLog, bundle: ExportBundle): ImportResult {
  const existing = log.db
    .prepare<[], { n: number }>('SELECT COUNT(*) as n FROM events')
    .get();
  if (existing && existing.n > 0) {
    throw new NonEmptyImportTargetError(existing.n);
  }

  const chainRows: ChainRow[] = bundle.events.map((event) => ({
    seq: event.seq,
    eventType: event.eventType,
    actorId: event.actorId,
    payloadJson: event.payloadJson,
    prevHash: event.prevHash,
    hash: event.hash,
  }));
  const preWriteResult = verifyChain(chainRows);
  if (!preWriteResult.valid) {
    throw new ChainVerificationFailedError(preWriteResult);
  }

  const run = log.db.transaction((): void => {
    for (const identity of bundle.identities) {
      if (getIdentity(log, identity.id)) continue;
      log.db
        .prepare(
          `INSERT INTO identities (id, name, kind, auth_provider, role, model_hint, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          identity.id,
          identity.name,
          identity.kind,
          identity.authProvider,
          identity.role,
          identity.modelHint,
          identity.createdAt,
        );
    }
    for (const event of bundle.events) {
      log.db
        .prepare(
          `INSERT INTO events (seq, event_type, actor_id, ticket_id, run_id, payload, created_at, prev_hash, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.seq,
          event.eventType,
          event.actorId,
          event.ticketId,
          event.runId,
          event.payloadJson,
          event.createdAt,
          event.prevHash,
          event.hash,
        );
    }
    for (const receipt of bundle.receipts) {
      log.db
        .prepare(
          `INSERT INTO receipts (id, kind, project_id, phase, ticket_id, validators, input_tree_hash, verify_command, verify_exit, signed_by, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          receipt.id,
          receipt.kind,
          receipt.projectId,
          receipt.phase,
          receipt.ticketId,
          receipt.validatorsJson,
          receipt.inputTreeHash,
          receipt.verifyCommand,
          receipt.verifyExit,
          receipt.signedBy,
          receipt.payloadJson,
          receipt.createdAt,
        );
    }
  });
  run();

  const persistedRows = log.db
    .prepare<
      [],
      Pick<EventRow, 'seq' | 'event_type' | 'actor_id' | 'payload' | 'prev_hash' | 'hash'>
    >(
      'SELECT seq, event_type, actor_id, payload, prev_hash, hash FROM events ORDER BY seq ASC',
    )
    .all();
  const postWriteResult = verifyChain(
    persistedRows.map((row) => ({
      seq: row.seq,
      eventType: row.event_type,
      actorId: row.actor_id,
      payloadJson: row.payload,
      prevHash: row.prev_hash,
      hash: row.hash,
    })),
  );
  if (!postWriteResult.valid) {
    throw new ChainVerificationFailedError(postWriteResult);
  }

  return {
    identitiesImported: bundle.identities.length,
    eventsImported: bundle.events.length,
    receiptsImported: bundle.receipts.length,
    chain: postWriteResult,
  };
}
