import { describe, expect, it } from 'vitest';
import { computeDownstreamStaleness, type PhaseReceiptRef } from './staleness.js';
import type { ReceiptVerificationResult } from './types.js';

const VALID: ReceiptVerificationResult = { valid: true, reasons: [] };

describe('computeDownstreamStaleness (FR-P3)', () => {
  it('every phase fresh when every receipt verifies clean', () => {
    const refs: PhaseReceiptRef[] = [
      { phaseId: 0, receiptId: 'r0' },
      { phaseId: 1, receiptId: 'r1' },
      { phaseId: 2, receiptId: 'r2' },
    ];
    const results = computeDownstreamStaleness(refs, () => VALID);
    expect(results.every((r) => !r.stale)).toBe(true);
  });

  it('an edited phase-2 doc flags phase 2 stale directly, phases 0-1 unaffected', () => {
    const refs: PhaseReceiptRef[] = [
      { phaseId: 0, receiptId: 'r0' },
      { phaseId: 1, receiptId: 'r1' },
      { phaseId: 2, receiptId: 'r2' },
    ];
    const results = computeDownstreamStaleness(refs, (ref) =>
      ref.phaseId === 2 ? { valid: false, reasons: ['SRS.md changed'] } : VALID,
    );
    expect(results.find((r) => r.phaseId === 0)?.stale).toBe(false);
    expect(results.find((r) => r.phaseId === 1)?.stale).toBe(false);
    const phase2 = results.find((r) => r.phaseId === 2);
    expect(phase2?.stale).toBe(true);
    expect(phase2?.reasons).toEqual(['SRS.md changed']);
  });

  it('AC1: edits invalidate DOWNSTREAM receipts too, visibly, once an earlier phase goes stale', () => {
    const refs: PhaseReceiptRef[] = [
      { phaseId: 1, receiptId: 'r1' },
      { phaseId: 2, receiptId: 'r2' },
      { phaseId: 3, receiptId: 'r3' },
    ];
    const results = computeDownstreamStaleness(refs, (ref) =>
      ref.phaseId === 1 ? { valid: false, reasons: ['SCOPE.md changed'] } : VALID,
    );
    const phase1 = results.find((r) => r.phaseId === 1);
    const phase2 = results.find((r) => r.phaseId === 2);
    const phase3 = results.find((r) => r.phaseId === 3);
    expect(phase1?.stale).toBe(true);
    expect(phase1?.reasons).toEqual(['SCOPE.md changed']);
    // Downstream phases carry their OWN "why" — inherited staleness, not
    // silently marked with no explanation (FR-P3's "and why").
    expect(phase2?.stale).toBe(true);
    expect(phase2?.reasons[0]).toContain('downstream of phase 1');
    expect(phase3?.stale).toBe(true);
    expect(phase3?.reasons[0]).toContain('downstream of phase 1');
  });

  it('handles sparse receipt sets (a phase with no receipt yet is simply absent from the input)', () => {
    const refs: PhaseReceiptRef[] = [{ phaseId: 3, receiptId: 'r3' }];
    const results = computeDownstreamStaleness(refs, () => VALID);
    expect(results).toEqual([{ phaseId: 3, stale: false, reasons: [] }]);
  });

  it('evaluates out-of-order input in phase order regardless of input array order', () => {
    const refs: PhaseReceiptRef[] = [
      { phaseId: 2, receiptId: 'r2' },
      { phaseId: 0, receiptId: 'r0' },
      { phaseId: 1, receiptId: 'r1' },
    ];
    const seen: number[] = [];
    computeDownstreamStaleness(refs, (ref) => {
      seen.push(ref.phaseId);
      return VALID;
    });
    expect(seen).toEqual([0, 1, 2]);
  });
});
