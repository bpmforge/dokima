import { describe, expect, it } from 'vitest';
import { decideAdvance } from './advance.js';
import { MERMAID_VALIDATOR, getPhase } from './topology.js';
import type { ReceiptVerificationResult } from './types.js';

const VALID: ReceiptVerificationResult = { valid: true, reasons: [] };
function invalid(...reasons: string[]): ReceiptVerificationResult {
  return { valid: false, reasons };
}

describe('decideAdvance (FR-P1/P2)', () => {
  it('allows advance when the gate receipt verifies clean', () => {
    const result = decideAdvance(
      { fromPhaseId: 2, gateReceiptId: 'gate-2', waiverReceiptId: null },
      { verifyReceipt: () => VALID },
    );
    expect(result).toEqual({
      allowed: true,
      fromPhaseId: 2,
      toPhaseId: 3,
      waived: false,
      reasons: [],
    });
  });

  it('refuses advance when no gate receipt exists yet', () => {
    const result = decideAdvance(
      { fromPhaseId: 0, gateReceiptId: null, waiverReceiptId: null },
      { verifyReceipt: () => VALID },
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/no gate receipt/);
  });

  it('refuses advance and surfaces reasons when the gate receipt is stale and no waiver is offered', () => {
    const result = decideAdvance(
      { fromPhaseId: 2, gateReceiptId: 'gate-2', waiverReceiptId: null },
      { verifyReceipt: () => invalid('input tree hash mismatch') },
    );
    expect(result.allowed).toBe(false);
    expect(result.waived).toBe(false);
    expect(result.reasons).toEqual(['input tree hash mismatch']);
  });

  it('RED FIXTURE — decideAdvance demands validate-mermaid for every phase (R-H3), not just decoratively', () => {
    // Not tautological: this proves decideAdvance actually THREADS
    // PHASES[n].validators into the verify seam as `requiredValidators`
    // (the FR-P2 "currently required set" a real verifyReceipt would use to
    // flag a stale/broken-diagram receipt) — it doesn't just carry mermaid
    // as decorative data alongside a verify call that ignores it.
    const requiredSetsSeen: readonly string[][] = [];
    decideAdvance(
      { fromPhaseId: 3, gateReceiptId: 'gate-3', waiverReceiptId: null },
      {
        verifyReceipt: (_id, requiredValidators) => {
          (requiredSetsSeen as string[][]).push([...requiredValidators]);
          return VALID;
        },
      },
    );
    expect(requiredSetsSeen).toEqual([getPhase(3).validators]);
    expect(requiredSetsSeen[0]).toContain(MERMAID_VALIDATOR);
  });

  it('RED FIXTURE — a broken mermaid diagram (stale validator set) refuses advance', () => {
    // Simulates a phase whose gate receipt is missing a clean run of the
    // required mermaid validator (R-H3): verifyReceipt reports it as the
    // stale-validator reason, exactly as @dokima/events' verifyReceipt
    // would when `validate-mermaid` isn't present with exitCode 0 — and
    // asserts the refusal fires only because `validate-mermaid` really is
    // among the validators decideAdvance demanded (previous test).
    expect(getPhase(3).validators).toContain(MERMAID_VALIDATOR);
    const result = decideAdvance(
      { fromPhaseId: 3, gateReceiptId: 'gate-3', waiverReceiptId: null },
      {
        verifyReceipt: (_id, requiredValidators) =>
          requiredValidators.includes(MERMAID_VALIDATOR)
            ? invalid(
                `validator set is stale — currently-required validator(s) not satisfied: ${MERMAID_VALIDATOR}`,
              )
            : VALID,
      },
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain(MERMAID_VALIDATOR);
  });

  it('allows advance on a waiver-eligible phase when the gate is stale but a waiver verifies clean', () => {
    const result = decideAdvance(
      { fromPhaseId: 1, gateReceiptId: 'gate-1', waiverReceiptId: 'waiver-1' },
      {
        verifyReceipt: (id) => (id === 'gate-1' ? invalid('doc edited') : VALID),
      },
    );
    expect(result).toEqual({
      allowed: true,
      fromPhaseId: 1,
      toPhaseId: 2,
      waived: true,
      reasons: [],
    });
  });

  it('re-verifies the waiver receipt with an empty required-validator set — a waiver bypasses validator currency, not vice versa', () => {
    const waiverRequiredSets: readonly string[][] = [];
    decideAdvance(
      { fromPhaseId: 1, gateReceiptId: 'gate-1', waiverReceiptId: 'waiver-1' },
      {
        verifyReceipt: (id, requiredValidators) => {
          if (id === 'waiver-1')
            (waiverRequiredSets as string[][]).push([...requiredValidators]);
          return id === 'gate-1' ? invalid('doc edited') : VALID;
        },
      },
    );
    expect(waiverRequiredSets).toEqual([[]]);
  });

  it('refuses when the offered waiver itself does not verify (e.g. agent-signed)', () => {
    const result = decideAdvance(
      { fromPhaseId: 1, gateReceiptId: 'gate-1', waiverReceiptId: 'waiver-1' },
      {
        verifyReceipt: (id) =>
          id === 'gate-1'
            ? invalid('doc edited')
            : invalid('waiver signer is agent-blocklisted'),
      },
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(['waiver signer is agent-blocklisted']);
  });

  it('RED FIXTURE — a validly-signed waiver still cannot cross phase 4→5 (build/verify never softens, FR-G5)', () => {
    // Phase 4 is the only build/verify phase with a next phase to advance
    // into (phase 5 is terminal — covered by the "last phase" test below).
    // Both the gate AND the waiver verify as genuinely clean/human-signed —
    // the attack this fixture must defeat is "a real waiver, just aimed at
    // the wrong phase", not a forged one.
    const result = decideAdvance(
      { fromPhaseId: 4, gateReceiptId: 'gate', waiverReceiptId: 'waiver' },
      { verifyReceipt: (id) => (id === 'gate' ? invalid('build failed') : VALID) },
    );
    expect(result.allowed).toBe(false);
    expect(result.waived).toBe(false);
    expect(result.reasons.join(' ')).toContain('FR-G5');
  });

  it('throws when asked to advance past the last phase', () => {
    expect(() =>
      decideAdvance(
        { fromPhaseId: 5, gateReceiptId: 'gate-5', waiverReceiptId: null },
        { verifyReceipt: () => VALID },
      ),
    ).toThrow(/last phase/);
  });
});
