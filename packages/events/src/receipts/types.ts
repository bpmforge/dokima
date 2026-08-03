/**
 * receipts/types.ts — the shared receipt shapes.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */


export type ReceiptKind =
  'gate' | 'close' | 'waiver' | 'challenge' | 'coverage' | 'fitness';

export interface ValidatorResult {
  name: string;
  exitCode: number;
  gapCount: number;
}

export interface ReceiptInputFile {
  path: string;
  content: string;
}

export interface ReceiptRecord {
  id: string;
  kind: ReceiptKind;
  projectId: string;
  phase: number | null;
  ticketId: string | null;
  validators: ValidatorResult[];
  inputTreeHash: string;
  verifyCommand: string | null;
  verifyExit: number | null;
  signedBy: string | null;
  payload: unknown;
  createdAt: string;
}
