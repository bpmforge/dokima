import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

  it('phase 3 (Design) validators are in full parity with validate-phase-gate.sh phase-3, incl. the module-boundary and challenger-gate laws', () => {
    expect(getPhase(3).validators).toEqual([
      'validate-module-design',
      'validate-flows',
      'validate-design-tokens',
      'validate-circular-deps',
      'validate-module-boundaries-transitive',
      'validate-infrastructure',
      'validate-observability',
      'validate-data-governance',
      'validate-resilience-patterns',
      'validate-architecture',
      'validate-api-coverage',
      'validate-sequence-coverage',
      'validate-erd-coverage',
      'validate-no-ascii-art',
      MERMAID_VALIDATOR,
      'validate-doc-render-health',
      'validate-c3-coverage',
      'validate-entry-points',
      'validate-tech-stack',
      'validate-adrs',
      'validate-security-controls',
      'validate-challenger-gate',
      'validate-tracker-integrity',
      'validate-ux-spec',
      'validate-spec-traceability',
    ]);
  });

  it('phase 4 (Build) validators are in full parity with validate-phase-gate.sh phase-4 (minus the two filesystem-conditional UX validators)', () => {
    expect(getPhase(4).validators).toEqual([
      'validate-build',
      'validate-lint',
      'validate-tests',
      'validate-tests-mapping',
      'validate-e2e-setup',
      'validate-migrations',
      'validate-iac',
      'validate-module-boundaries',
      'validate-api-consistency',
      'validate-code-health',
      'validate-dead-code',
      'validate-file-size',
      'validate-tickets',
      'validate-ticket-hygiene',
      'validate-tracker-integrity',
      'validate-challenger-gate',
      MERMAID_VALIDATOR,
    ]);
  });

  it('phase 5 (Launch) validators are in full parity with validate-phase-gate.sh phase-5, incl. requirement-closure and challenger-gate', () => {
    expect(getPhase(5).validators).toEqual([
      'validate-build',
      'validate-lint',
      'validate-tests',
      'validate-deps',
      'validate-smoke',
      'validate-fix-backlog-closed',
      'validate-challenger-gate',
      'validate-model-pins',
      'validate-code-health',
      'validate-dead-code',
      'validate-module-boundaries',
      'validate-api-consistency',
      'validate-contract-conformance',
      'validate-release-readiness',
      'validate-requirement-closure',
      MERMAID_VALIDATOR,
    ]);
  });

  it('every validator named in PHASES exists as a real script under content/validators/', () => {
    const validatorsDir = path.resolve(HERE, '../../../../content/validators');
    for (const phase of PHASES) {
      for (const validator of phase.validators) {
        const scriptPath = path.join(validatorsDir, `${validator}.sh`);
        expect(existsSync(scriptPath), `${scriptPath} should exist`).toBe(true);
      }
    }
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
