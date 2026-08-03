/**
 * receipts/query.ts — receipt reads and anchoring-event lookup.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */

import { listEvents } from '../append.js';
import type { EventLog } from '../types.js';
import type { ReceiptKind, ReceiptRecord } from './types.js';
import { rowToRecord, type ReceiptRow } from './mint.js';
import { eventTypeForKind } from './mac.js';


export function getReceipt(log: EventLog, id: string): ReceiptRecord | undefined {
  const row = log.db
    .prepare<[string], ReceiptRow>('SELECT * FROM receipts WHERE id = ?')
    .get(id);
  return row ? rowToRecord(row) : undefined;
}

export interface MintEventPayload {
  receiptId?: string;
  kind?: ReceiptKind;
  contentMac?: string;
}

/**
 * The event anchoring a receipt for *informational* reads (who minted it),
 * matched by kind-appropriate eventType and receiptId only. This does NOT
 * verify the MAC — reading the claimed actor is not a trust decision.
 * `verifyReceipt` does the MAC-checked lookup; the two must not be conflated.
 */
export function findAnchorEvent(
  log: EventLog,
  receipt: ReceiptRecord,
): { actorId: string } | undefined {
  const expectedType = eventTypeForKind(receipt.kind);
  return listEvents(log).find((event) => {
    if (event.eventType !== expectedType) return false;
    const payload = event.payload as MintEventPayload | null;
    return payload?.receiptId === receipt.id;
  });
}

/** The identity that minted a receipt, read off its anchoring event (receipts carry no actor column of their own). */
export function getReceiptActor(log: EventLog, receiptId: string): string | null {
  const receipt = getReceipt(log, receiptId);
  if (!receipt) return null;
  return findAnchorEvent(log, receipt)?.actorId ?? null;
}

