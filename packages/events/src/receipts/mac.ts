/**
 * receipts/mac.ts — the hash-chain crypto primitives. Field order and length-prefixing here are load-bearing and unmigratable.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */

import {
  createHash,
  createHmac,
  timingSafeEqual,
  type Hash,
  type Hmac,
} from 'node:crypto';
import type { ReceiptInputFile, ReceiptKind, ReceiptRecord, ValidatorResult } from './types.js';

/**
 * The minting secret (the HMAC key for the receipt anchor tag) must be a
 * non-empty value resolved from the keychain by the trusted minting path —
 * never a literal in code, settings, a prompt, or the event log (FR-S2,
 * law #8). A missing/empty key is a wiring bug, not a soft default: an empty
 * key would make the tag reproducible by any caller and reopen the forgery
 * path the tag exists to close, so we fail loudly instead.
 */
export class SigningKeyRequiredError extends Error {
  constructor() {
    super(
      'a non-empty minting secret is required — resolve it from the keychain in the ' +
        'trusted minting path (FR-S2); receipts.ts never holds a default key',
    );
    this.name = 'SigningKeyRequiredError';
  }
}

export function assertSigningKey(signingKey: string): void {
  if (!signingKey) throw new SigningKeyRequiredError();
}

function lengthPrefixed(h: Hash | Hmac, value: string): void {
  const buf = Buffer.from(value, 'utf8');
  h.update(String(buf.length));
  h.update('\n');
  h.update(buf);
}

/**
 * Deterministic hash of an input-file tree (BLUEPRINT §3.2). Sorted by path
 * and length-prefixed per field for the same injectivity reason as
 * `computeEventHash` (hash.ts) — touching any file's content, or adding or
 * removing one, changes the result.
 */
export function computeInputTreeHash(files: readonly ReceiptInputFile[]): string {
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const h = createHash('sha256');
  for (const file of sorted) {
    lengthPrefixed(h, file.path);
    lengthPrefixed(h, file.content);
  }
  return h.digest('hex');
}

/** Fields covered by the anchoring event's MAC — everything that identifies what the receipt attests to. */
export interface ReceiptContent {
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
}

export const eventTypeForKind = (kind: ReceiptKind): string =>
  kind === 'waiver' ? 'gate.waived' : 'gate.receipt_minted';

/**
 * Keyed MAC (HMAC-SHA256) binding a receipts row to its anchoring event.
 * Each field is independently JSON-encoded (so `null` and `""` can't
 * collide) then length-prefixed (so field boundaries can't shift) before
 * being fed to the MAC — same injectivity discipline as `computeEventHash`
 * (hash.ts). `mintReceipt` stores the tag in the anchoring event's payload;
 * `verifyReceipt` recomputes it from the row and requires a match.
 *
 * Why a *keyed* MAC, not a plain hash: the row and the anchoring event are
 * both reachable by any code with a `log.db` handle, and this file (with the
 * exact tag algorithm) is readable. A plain content hash is therefore
 * reproducible by an untrusted caller — a forged row plus a self-consistent
 * forged event would recompute to the same digest and verify. The HMAC key
 * is the one input a forger cannot reconstruct from source: it is resolved
 * from the keychain by the trusted minting path (the Harbormaster, which
 * mints receipts from *outside* the untrusted agent session — ARCHITECTURE
 * §2) and is never present in agent-session context (FR-S2, law #8). So a
 * valid tag is evidence the secret-holder produced it.
 *
 * Scope boundary (do not overclaim): this makes forgery require possession
 * of the minting secret. The key *is* the trust boundary — by design, a
 * process holding it is the trusted minter, so "a process with both the key
 * and a `log.db` handle can mint" is not a hole but the definition of the
 * trusted path. Keeping the key (and the raw db handle) out of untrusted
 * agent-session processes entirely is the complementary process-boundary
 * fix (route all durable writes through a privileged gateway) — an
 * ARCHITECTURE-level concern outside this primitive's write_scope. What this
 * ticket delivers is the tag such a boundary needs.
 *
 * Exported so tests can construct forgeries (tagged with an attacker-chosen
 * key, to prove they fail) and, for the FR-P2 isolation test, a validly-
 * tagged row (to prove the waiver re-check is independent of the tag). HMAC
 * security rests on key secrecy, not on hiding this function.
 */
export function computeReceiptMac(content: ReceiptContent, signingKey: string): string {
  assertSigningKey(signingKey);
  const h = createHmac('sha256', signingKey);
  const field = (value: unknown): void => lengthPrefixed(h, JSON.stringify(value));
  field(content.id);
  field(content.kind);
  field(content.projectId);
  field(content.phase);
  field(content.ticketId);
  field(content.validators);
  field(content.inputTreeHash);
  field(content.verifyCommand);
  field(content.verifyExit);
  field(content.signedBy);
  return h.digest('hex');
}

/** Constant-time compare of two hex MAC strings; length mismatch is a non-match, not a throw. */
export function macEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function receiptContent(receipt: ReceiptRecord): ReceiptContent {
  return {
    id: receipt.id,
    kind: receipt.kind,
    projectId: receipt.projectId,
    phase: receipt.phase,
    ticketId: receipt.ticketId,
    validators: receipt.validators,
    inputTreeHash: receipt.inputTreeHash,
    verifyCommand: receipt.verifyCommand,
    verifyExit: receipt.verifyExit,
    signedBy: receipt.signedBy,
  };
}

