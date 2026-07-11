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

/**
 * `hash = sha256( LP(prev_hash) ‖ LP(seq) ‖ LP(type) ‖ LP(actor) ‖ LP(payload) )`
 * where `LP(x) = utf8ByteLength(x) ‖ "\n" ‖ x` (ARCHITECTURE.md §3).
 *
 * Each field is length-prefixed so the preimage is INJECTIVE. A plain
 * concatenation (the naive form) has no field boundaries, so distinct events
 * hash identically whenever a boundary can shift — e.g. `(seq=1,type="2x")` and
 * `(seq=12,type="x")` both yield `…12x…`, and `(actor="u1",payload="23")`
 * collides with `(actor="u12",payload="3")`. That would let a tampered event
 * forge a matching hash, defeating the chain's tamper-evidence (NFR-4/6), which
 * is this module's entire purpose. Length-prefixing removes the ambiguity.
 */
export function computeEventHash(input: HashInput): string {
  const h = createHash('sha256');
  const field = (value: string): void => {
    const buf = Buffer.from(value, 'utf8');
    h.update(String(buf.length));
    h.update('\n');
    h.update(buf);
  };
  field(input.prevHash);
  field(String(input.seq));
  field(input.eventType);
  field(input.actorId);
  field(input.payloadJson);
  return h.digest('hex');
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
