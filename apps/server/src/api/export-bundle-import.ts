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
 * tampered *input*. `verifyChain` itself is `@dokima/events`'s, already
 * a direct `apps/server` dependency — the single, authoritative
 * implementation of "valid chain" for the operational (SQLite-backed) path.
 *
 * `verifyChain` only covers events — it says nothing about whether a
 * receipt in the bundle was ever really minted. A receipt row is not
 * self-authenticating (`packages/events/migrations/002_receipts.sql` has no
 * signature column); its only proof of authenticity is a
 * `gate.receipt_minted`/`gate.waived` *event* whose payload carries a
 * `contentMac` HMAC-tagged with the project's secret `signingKey`
 * (`packages/events/src/receipts.ts`'s `verifyReceipt`). An actor holding
 * only the shared Bearer token (no `signingKey`) could otherwise POST a
 * bundle with a fabricated close/gate receipt and no matching anchor event
 * into an empty project and have it accepted — exactly the "flip state
 * without a real receipt" pattern law #4 prohibits. So before any write we
 * replay that same anchor check (part 1 of `verifyReceipt`) for every
 * bundle receipt against the *bundle's own* `events` array — the target
 * project's rows don't exist yet at this point, and don't need to; the
 * bundle must be internally self-proving.
 */
import {
  computeReceiptMac,
  getIdentity,
  verifyChain,
  type ChainRow,
  type ChainVerificationResult,
  type EventLog,
  type ReceiptContent,
  type ReceiptKind,
  type ValidatorResult,
} from '@dokima/events';
import { timingSafeEqual } from 'node:crypto';
import {
  ChainVerificationFailedError,
  NonEmptyImportTargetError,
  ReceiptAnchorVerificationFailedError,
  type BundleReceipt,
  type EventRow,
  type ExportBundle,
} from './export-bundle-types.js';

export interface ImportResult {
  identitiesImported: number;
  eventsImported: number;
  receiptsImported: number;
  chain: ChainVerificationResult;
}

export interface ImportExportBundleOptions {
  /** Same keychain-resolved minting secret `mintReceipt`/`verifyReceipt` use (FR-S2). */
  signingKey: string;
}

function macEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const anchorEventType = (kind: string): string =>
  kind === 'waiver' ? 'gate.waived' : 'gate.receipt_minted';

function expectedReceiptMac(
  receipt: BundleReceipt,
  signingKey: string,
): string | undefined {
  let validators: ValidatorResult[];
  try {
    validators = JSON.parse(receipt.validatorsJson) as ValidatorResult[];
  } catch {
    return undefined;
  }
  const content: ReceiptContent = {
    id: receipt.id,
    kind: receipt.kind as ReceiptKind,
    projectId: receipt.projectId,
    phase: receipt.phase,
    ticketId: receipt.ticketId,
    validators,
    inputTreeHash: receipt.inputTreeHash,
    verifyCommand: receipt.verifyCommand,
    verifyExit: receipt.verifyExit,
    signedBy: receipt.signedBy,
  };
  return computeReceiptMac(content, signingKey);
}

/** Anchor check (part 1 of `verifyReceipt`), replayed against the bundle's own `events` array. */
function findUnanchoredReceiptIds(bundle: ExportBundle, signingKey: string): string[] {
  const unanchored: string[] = [];
  for (const receipt of bundle.receipts) {
    const expectedMac = expectedReceiptMac(receipt, signingKey);
    const expectedType = anchorEventType(receipt.kind);
    const anchored =
      expectedMac !== undefined &&
      bundle.events.some((event) => {
        if (event.eventType !== expectedType) return false;
        let payload: unknown;
        try {
          payload = JSON.parse(event.payloadJson);
        } catch {
          return false;
        }
        if (typeof payload !== 'object' || payload === null) return false;
        const { receiptId, contentMac } = payload as {
          receiptId?: unknown;
          contentMac?: unknown;
        };
        if (receiptId !== receipt.id) return false;
        return typeof contentMac === 'string' && macEqual(contentMac, expectedMac);
      });
    if (!anchored) unanchored.push(receipt.id);
  }
  return unanchored;
}

export function importExportBundle(
  log: EventLog,
  bundle: ExportBundle,
  opts: ImportExportBundleOptions,
): ImportResult {
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

  const unanchoredReceiptIds = findUnanchoredReceiptIds(bundle, opts.signingKey);
  if (unanchoredReceiptIds.length > 0) {
    throw new ReceiptAnchorVerificationFailedError(unanchoredReceiptIds);
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
