/**
 * receipts/verify.ts — verifyReceipt.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */

import { listEvents } from '../append.js';
import { getIdentity } from '../identities.js';
import type { EventLog } from '../types.js';
import type { ReceiptInputFile } from './types.js';
import {
  assertSigningKey,
  computeInputTreeHash,
  computeReceiptMac,
  eventTypeForKind,
  macEqual,
  receiptContent,
} from './mac.js';
import { isBlockedAgentName, DEFAULT_AGENT_NAME_BLOCKLIST } from './waiver-policy.js';
import { getReceipt, type MintEventPayload } from './query.js';

export interface ReceiptVerificationResult {
  valid: boolean;
  /** Empty when valid; one entry per failed check when invalid. */
  reasons: string[];
}

export interface VerifyReceiptOptions {
  /**
   * Keychain-resolved minting secret (HMAC key), the same one `mintReceipt`
   * used. The trusted verifying path (Harbormaster) holds it; an untrusted
   * caller does not, which is what makes the anchor MAC unforgeable (FR-S2).
   */
  signingKey: string;
  /** Current contents of the receipt's declared input tree (BLUEPRINT §3.2: recompute input hash). */
  inputFiles: readonly ReceiptInputFile[];
  /** Validators currently required for this gate (BLUEPRINT §3.2: validator-set currency). */
  requiredValidators: readonly string[];
  /** Extra names to reject on top of DEFAULT_AGENT_NAME_BLOCKLIST (mirrors MintReceiptOptions). */
  agentNameBlocklist?: readonly string[];
}

/**
 * The two-way re-check from BLUEPRINT §3.2, plus the anti-forgery anchor
 * check:
 *
 * (1) Anchor MAC — an event of the kind-appropriate type
 * (`gate.receipt_minted` for non-waivers, `gate.waived` for waivers) whose
 * payload.contentMac equals the HMAC recomputed from this row's own fields
 * with the minting secret must exist. This catches a row inserted directly
 * with no real mint (no such event), a row paired with a naively-forged
 * event (wrong/missing MAC), and — because the key is not reconstructable
 * from source — a *self-consistent* forgery of any kind (row + event a
 * key-less attacker tagged so they agree with each other): the attacker's
 * tag won't equal the one recomputed under the real secret. See
 * `computeReceiptMac` for what this does and does not close.
 *
 * (2) Input-tree currency — recomputing the input-tree hash over the current
 * files must match the stored hash (catches silently edited input files).
 *
 * (3) Validator currency — every currently-required validator must appear in
 * the receipt with exit code 0 (catches gate-definition drift: a validator
 * added since the receipt was minted makes it stale even though its own hash
 * still checks out).
 *
 * (4) Waiver FR-P2 re-check — for waiver receipts, `signedBy` is re-resolved
 * to a human identity and re-checked against the agent-name blocklist,
 * independently of the MAC. Waivers thus get *two* independent guards (the
 * MAC and this re-check); the re-check exists so that even a validly-tagged
 * waiver (e.g. one minted before a signer's identity was reclassified, or in
 * a world where the secret leaked) cannot pass as an agent-signed waiver.
 * Gate/close/challenge/coverage/fitness receipts get only the MAC guard here
 * — re-running their actual validators server-side is the Harbormaster's job
 * (it mints from ground truth), not this primitive's.
 */
export function verifyReceipt(
  log: EventLog,
  receiptId: string,
  opts: VerifyReceiptOptions,
): ReceiptVerificationResult {
  assertSigningKey(opts.signingKey);
  const receipt = getReceipt(log, receiptId);
  if (!receipt) {
    return { valid: false, reasons: ['receipt not found'] };
  }

  const reasons: string[] = [];

  const expectedType = eventTypeForKind(receipt.kind);
  const expectedMac = computeReceiptMac(receiptContent(receipt), opts.signingKey);
  const anchored = listEvents(log).some((event) => {
    if (event.eventType !== expectedType) return false;
    const payload = event.payload as MintEventPayload | null;
    if (payload?.receiptId !== receipt.id) return false;
    return (
      typeof payload.contentMac === 'string' && macEqual(payload.contentMac, expectedMac)
    );
  });
  if (!anchored) {
    reasons.push(
      'no anchoring gate.receipt_minted/gate.waived event with a matching content MAC — not minted by a real run',
    );
  }

  if (receipt.kind === 'waiver') {
    const blocklist = [
      ...DEFAULT_AGENT_NAME_BLOCKLIST,
      ...(opts.agentNameBlocklist ?? []),
    ];
    if (!receipt.signedBy) {
      reasons.push('waiver receipt has no signedBy (FR-P2)');
    } else {
      const signer = getIdentity(log, receipt.signedBy);
      if (!signer) {
        reasons.push(`waiver signedBy identity not found: ${receipt.signedBy} (FR-P2)`);
      } else if (signer.kind !== 'human') {
        reasons.push(
          `waiver requires a human signature; identity "${signer.id}" is kind "${signer.kind}" (FR-P2)`,
        );
      } else if (isBlockedAgentName(signer.name, blocklist)) {
        reasons.push(
          `waiver signer name "${signer.name}" matches the agent-name blocklist (FR-P2/FR-N3)`,
        );
      }
    }
  }

  const recomputedHash = computeInputTreeHash(opts.inputFiles);
  if (recomputedHash !== receipt.inputTreeHash) {
    reasons.push(
      'input tree hash mismatch — an input file changed since the receipt was minted',
    );
  }

  const missingValidators = opts.requiredValidators.filter(
    (name) => !receipt.validators.some((v) => v.name === name && v.exitCode === 0),
  );
  if (missingValidators.length > 0) {
    reasons.push(
      `validator set is stale — currently-required validator(s) not satisfied: ${missingValidators.join(', ')}`,
    );
  }

  return { valid: reasons.length === 0, reasons };
}
