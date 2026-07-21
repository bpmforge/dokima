import { createHash } from 'node:crypto';
import type { ExportedEvent } from './types.js';

/**
 * Mirrors `packages/events/src/hash.ts`'s `GENESIS_HASH` /
 * `computeEventHash` / `verifyChain` exactly (ARCHITECTURE.md §3's
 * documented preimage: `sha256(LP(prev_hash)‖LP(seq)‖LP(type)‖LP(actor)‖
 * LP(payload))`, length-prefixed per field for injectivity). This module
 * cannot *import* that one — `packages/shared` sits below `packages/events`
 * in the dependency matrix (ARCHITECTURE.md §4: shared has no dependency on
 * events) — and that is the point, not an accident: a portable export
 * bundle (BLUEPRINT §12.8's "no lock-in") must be verifiable with nothing
 * but this shared library and the JSON file, no SQLite/events package or
 * open project required. Any change to the algorithm in hash.ts must be
 * mirrored here, or exported bundles minted before/after the change will
 * disagree on validity — there is no automated guard against that drift
 * today (documented risk, not a TODO to silently paper over).
 */
export const GENESIS_HASH = '0'.repeat(64);

export interface BundleHashInput {
  prevHash: string;
  seq: number;
  eventType: string;
  actorId: string;
  payloadJson: string;
}

export function computeBundleEventHash(input: BundleHashInput): string {
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

export interface BundleChainVerificationResult {
  valid: boolean;
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Walks a bundle's `events` array (assumed seq-ascending — callers should
 * validate ordering separately, e.g. `validateExportBundle`) and recomputes
 * the hash chain from genesis. Any edit, reorder, or truncation of a prefix
 * flips `valid` to false at the first seq where the recomputed hash no
 * longer matches — same tamper-evidence guarantee as the live event log's
 * `verifyChain` (NFR-4/6).
 */
export function verifyBundleChain(
  events: readonly ExportedEvent[],
): BundleChainVerificationResult {
  let expectedPrevHash = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAtSeq: event.seq,
        reason: 'prev_hash does not match prior event hash',
      };
    }
    const expectedHash = computeBundleEventHash({
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
