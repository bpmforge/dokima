import { describe, expect, it } from 'vitest';
import {
  MERMAID_VALIDATOR,
  PHASES,
  UnknownPhaseError,
  getPhase,
  isLastPhase,
  nextPhase,
  priorPhase,
} from './topology.js';

describe('PHASES topology', () => {
  it('AC1: declares exactly six phases, 0..5 in order, named per BLUEPRINT §3.2', () => {
    expect(PHASES.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(PHASES.map((p) => p.name)).toEqual([
      'Idea',
      'Plan',
      'Define',
      'Design',
      'Build',
      'Launch',
    ]);
  });

  it('AC2/R-H3: every phase validator set includes the mermaid-parse validator', () => {
    for (const phase of PHASES) {
      expect(phase.validators).toContain(MERMAID_VALIDATOR);
    }
  });

  it('every phase declares at least one non-mermaid validator or is doc-phase-only by design (0/1)', () => {
    // Phases 0/1 are interview-driven with no source-system validator set
    // (validate-phase-gate.sh has none for them either) — mermaid is their
    // only gate input, which is the R-H3 amendment's whole point.
    expect(getPhase(0).validators).toEqual([MERMAID_VALIDATOR]);
    expect(getPhase(1).validators).toEqual([MERMAID_VALIDATOR]);
    expect(getPhase(2).validators.length).toBeGreaterThan(1);
    expect(getPhase(3).validators.length).toBeGreaterThan(1);
    expect(getPhase(4).validators.length).toBeGreaterThan(1);
    expect(getPhase(5).validators.length).toBeGreaterThan(1);
  });

  it('FR-G5: waiver-eligible on phases 0-3 only, never on build/verify phases 4-5', () => {
    expect(getPhase(0).waiverEligible).toBe(true);
    expect(getPhase(1).waiverEligible).toBe(true);
    expect(getPhase(2).waiverEligible).toBe(true);
    expect(getPhase(3).waiverEligible).toBe(true);
    expect(getPhase(4).waiverEligible).toBe(false);
    expect(getPhase(5).waiverEligible).toBe(false);
  });

  it('every deliverable names a producing role', () => {
    for (const phase of PHASES) {
      expect(phase.deliverables.length).toBeGreaterThan(0);
      for (const deliverable of phase.deliverables) {
        expect(deliverable.producingRole.length).toBeGreaterThan(0);
      }
    }
  });

  it('getPhase throws UnknownPhaseError for an out-of-range id', () => {
    // @ts-expect-error deliberately out of the PhaseId union for the runtime check
    expect(() => getPhase(6)).toThrow(UnknownPhaseError);
  });

  it('priorPhase/nextPhase walk the chain; priorPhase(0) is null; nextPhase(5) throws', () => {
    expect(priorPhase(0)).toBeNull();
    expect(priorPhase(3)?.id).toBe(2);
    expect(nextPhase(0).id).toBe(1);
    expect(nextPhase(4).id).toBe(5);
    expect(() => nextPhase(5)).toThrow(UnknownPhaseError);
  });

  it('isLastPhase is true only for phase 5', () => {
    expect(isLastPhase(0)).toBe(false);
    expect(isLastPhase(4)).toBe(false);
    expect(isLastPhase(5)).toBe(true);
  });
});
