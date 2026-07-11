import { createHash } from 'node:crypto';

/** prev_hash of the first event in a chain (DATABASE.md §2). */
export const GENESIS_HASH = '0'.repeat(64);

export interface HashInput {
  prevHash: string;
  seq: number;
  eventType: string;
  actorId: string;
  /** The exact JSON text stored in the `payload` column — never a re-serialization. */
  payloadJson: string;
}

/** `hash = sha256(prev_hash‖seq‖type‖actor‖payload)` (ARCHITECTURE.md §3). */
export function computeEventHash(input: HashInput): string {
  return createHash('sha256')
    .update(input.prevHash)
    .update(String(input.seq))
    .update(input.eventType)
    .update(input.actorId)
    .update(input.payloadJson)
    .digest('hex');
}

export interface ChainRow {
  seq: number;
  eventType: string;
  actorId: string;
  payloadJson: string;
  prevHash: string;
  hash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Walks an ordered event sequence and recomputes the hash chain. Any edit,
 * reorder, or truncation of a prefix flips `valid` to false at the first
 * seq where the recomputed hash no longer matches (NFR-4/6).
 */
export function verifyChain(events: readonly ChainRow[]): ChainVerificationResult {
  let expectedPrevHash = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAtSeq: event.seq,
        reason: 'prev_hash does not match prior event hash',
      };
    }
    const expectedHash = computeEventHash({
      prevHash: event.prevHash,
      seq: event.seq,
      eventType: event.eventType,
      actorId: event.actorId,
      payloadJson: event.payloadJson,
    });
    if (event.hash !== expectedHash) {
      return {
        valid: false,
        brokenAtSeq: event.seq,
        reason: 'hash does not match recomputed value',
      };
    }
    expectedPrevHash = event.hash;
  }
  return { valid: true, brokenAtSeq: null, reason: null };
}
