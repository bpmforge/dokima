/**
 * Reads the durable "source of truth" trio straight off the columns
 * (DATABASE.md §2: events + identities + receipts) via raw SQL rather than
 * `listEvents`/`getReceipt` — those parse `payload` into `unknown` and
 * would require re-`JSON.stringify`-ing it for the bundle, which is not
 * guaranteed to reproduce the exact bytes the hash was computed over.
 */
import type { EventLog } from '@shipwright/events';
import {
  EXPORT_BUNDLE_VERSION,
  type EventRow,
  type ExportBundle,
  type IdentityRow,
  type ReceiptRow,
} from './export-bundle-types.js';

export function buildExportBundle(
  log: EventLog,
  opts: { projectId: string; now?: () => string },
): ExportBundle {
  const now = opts.now ?? (() => new Date().toISOString());
  const identityRows = log.db
    .prepare<[], IdentityRow>(
      'SELECT id, name, kind, auth_provider, role, model_hint, created_at FROM identities ORDER BY created_at ASC, id ASC',
    )
    .all();
  const eventRows = log.db
    .prepare<[], EventRow>(
      'SELECT seq, event_type, actor_id, ticket_id, run_id, payload, created_at, prev_hash, hash FROM events ORDER BY seq ASC',
    )
    .all();
  const receiptRows = log.db
    .prepare<[], ReceiptRow>(
      'SELECT id, kind, project_id, phase, ticket_id, validators, input_tree_hash, verify_command, verify_exit, signed_by, payload, created_at FROM receipts ORDER BY created_at ASC, id ASC',
    )
    .all();

  return {
    version: EXPORT_BUNDLE_VERSION,
    projectId: opts.projectId,
    exportedAt: now(),
    identities: identityRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      authProvider: row.auth_provider,
      role: row.role,
      modelHint: row.model_hint,
      createdAt: row.created_at,
    })),
    events: eventRows.map((row) => ({
      seq: row.seq,
      eventType: row.event_type,
      actorId: row.actor_id,
      ticketId: row.ticket_id,
      runId: row.run_id,
      payloadJson: row.payload,
      createdAt: row.created_at,
      prevHash: row.prev_hash,
      hash: row.hash,
    })),
    receipts: receiptRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      projectId: row.project_id,
      phase: row.phase,
      ticketId: row.ticket_id,
      validatorsJson: row.validators,
      inputTreeHash: row.input_tree_hash,
      verifyCommand: row.verify_command,
      verifyExit: row.verify_exit,
      signedBy: row.signed_by,
      payloadJson: row.payload,
      createdAt: row.created_at,
    })),
  };
}
