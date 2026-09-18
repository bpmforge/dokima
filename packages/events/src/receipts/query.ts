/**
 * receipts/query.ts — receipt reads and anchoring-event lookup.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */

import type { EventLog } from '../types.js';
import type { ReceiptKind, ReceiptRecord } from './types.js';
import { rowToRecord, type ReceiptRow } from './mint.js';

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
