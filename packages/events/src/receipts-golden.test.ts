/**
 * Golden serialization fixture for the receipt hash chain (W10-47).
 *
 * WHY THIS FILE EXISTS, and why a passing test suite is not a substitute.
 * `computeReceiptMac` feeds ten fields in a fixed order through
 * `JSON.stringify` + length-prefixing; `computeInputTreeHash` sorts by path
 * and length-prefixes path and content. Change the order, the prefix format,
 * or the encoding, and the tags change — while every receipt already minted
 * into the append-only, hash-chained log (C-6) still carries the OLD tag.
 * Those cannot be recomputed or migrated: the log is append-only by law and
 * the inputs are gone.
 *
 * The rest of the suite cannot catch this, because it mints AND verifies with
 * the same post-change code, so it agrees with itself no matter what the bytes
 * are. These literal hex values were frozen from the pre-split implementation
 * and are the on-disk truth. If a change makes them differ, the change is
 * wrong — do not regenerate the fixture to make this pass.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeInputTreeHash,
  computeReceiptMac,
  type ReceiptContent,
  type ReceiptInputFile,
} from './receipts.js';
import golden from './receipts-golden.fixture.json' with { type: 'json' };

const KEY = golden.signingKey;

describe('receipt serialization is frozen (W10-47)', () => {
  it('every input-tree hash still equals its pre-split value', () => {
    for (const [name, expected] of Object.entries(golden.inputTreeHashes)) {
      const files = golden.trees[
        name as keyof typeof golden.trees
      ] as unknown as ReceiptInputFile[];
      expect(computeInputTreeHash(files), `inputTreeHash/${name}`).toBe(expected);
    }
  });

  it('every receipt MAC still equals its pre-split value', () => {
    for (const [name, expected] of Object.entries(golden.macs)) {
      const content = golden.contents[
        name as keyof typeof golden.contents
      ] as unknown as ReceiptContent;
      expect(computeReceiptMac(content, KEY), `mac/${name}`).toBe(expected);
    }
  });

  it('length-prefixing keeps field boundaries injective — the shift cases do not collide', () => {
    // 'a' + 'bc' and 'ab' + 'c' concatenate identically; only the length
    // prefix distinguishes them. Same reason each MAC field is independently
    // JSON-encoded rather than concatenated.
    expect(golden.inputTreeHashes.boundaryShift).not.toBe(
      golden.inputTreeHashes.boundaryShift2,
    );
    expect(golden.macs.nullTicket).not.toBe(golden.macs.emptyTicket);
    expect(golden.macs.nullVerify).not.toBe(golden.macs.emptyVerify);
    expect(golden.macs.phaseZero).not.toBe(golden.macs.phaseNull);
    // Swapping two field VALUES must change the tag, or field order is not bound.
    expect(golden.macs.swapped).not.toBe(golden.macs.base);
  });

  /**
   * The byte-level proof FILE_SIZE_DEBT.md asks for. Equal digests prove the
   * two implementations agree; this pins WHAT they agree on, reconstructing
   * the exact byte sequence independently of the implementation. A reordering
   * of the ten fields, or a change to the prefix format, fails here with a
   * readable diff rather than an opaque hex mismatch.
   */
  it('the exact byte sequence fed to the HMAC is pinned, not just the digest', () => {
    const prefix = (value: string): Buffer => {
      const buf = Buffer.from(value, 'utf8');
      return Buffer.concat([Buffer.from(`${buf.length}\n`, 'utf8'), buf]);
    };
    const content = golden.contents.base as unknown as ReceiptContent;
    // The documented field order, written out longhand on purpose.
    const bytes = Buffer.concat(
      [
        content.id,
        content.kind,
        content.projectId,
        content.phase,
        content.ticketId,
        content.validators,
        content.inputTreeHash,
        content.verifyCommand,
        content.verifyExit,
        content.signedBy,
      ].map((v) => prefix(JSON.stringify(v))),
    );
    const fromFormat = createHmac('sha256', KEY).update(bytes).digest('hex');
    // Both directions, deliberately. Comparing only against the frozen hex
    // would let this test pass while the implementation drifted — it never
    // calls the implementation. Comparing only against the implementation
    // would let both drift together. Pinning format == implementation ==
    // frozen value is what actually binds all three.
    expect(fromFormat).toBe(golden.macs.base);
    expect(computeReceiptMac(content, KEY)).toBe(fromFormat);
  });
});
