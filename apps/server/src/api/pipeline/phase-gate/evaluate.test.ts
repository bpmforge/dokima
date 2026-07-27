import { describe, expect, it } from 'vitest';
import type { ValidatorRunResult } from '@shipwright/validators';
import { evaluatePhaseGateResults } from './evaluate.js';

function result(overrides: Partial<ValidatorRunResult>): ValidatorRunResult {
  return {
    name: 'validate-mermaid',
    exitCode: 0,
    gapCount: 0,
    gaps: [],
    stdout: '',
    stderr: '',
    durationMs: 1,
    timedOut: false,
    ...overrides,
  };
}

describe('evaluatePhaseGateResults (W9-06 red fixtures, criteria 3/4)', () => {
  it('RED: a phase with no validator run at all (empty results) is refused, no receipt', () => {
    const outcome = evaluatePhaseGateResults([]);
    expect(outcome.ok).toBe(false);
    expect(outcome.reasons[0]).toMatch(/no validator run to attest/);
  });

  it('RED: a genuinely failing validator (exitCode 1, real gaps) is refused, not recorded as a pass', () => {
    const outcome = evaluatePhaseGateResults([result({ exitCode: 1, gapCount: 3 })]);
    expect(outcome.ok).toBe(false);
    expect(outcome.reasons[0]).toMatch(/exited 1 \(3 gap\(s\)\)/);
  });

  it('RED (trap 2): exitCode 2 — an untrustworthy verdict (timeout/spawn-error/malformed output) — is refused, never coerced to a pass', () => {
    const outcome = evaluatePhaseGateResults([
      result({ exitCode: 2, gapCount: 1, timedOut: true }),
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.reasons[0]).toMatch(/exited 2/);
  });

  it('refuses when even one validator in an otherwise-clean set fails', () => {
    const outcome = evaluatePhaseGateResults([
      result({ name: 'validate-mermaid', exitCode: 0 }),
      result({ name: 'validate-use-cases', exitCode: 1, gapCount: 2 }),
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.reasons).toHaveLength(1);
    expect(outcome.reasons[0]).toMatch(/validate-use-cases/);
  });

  it('GREEN: every validator clean (exitCode 0) is accepted', () => {
    const outcome = evaluatePhaseGateResults([
      result({ name: 'validate-mermaid', exitCode: 0 }),
      result({ name: 'validate-use-cases', exitCode: 0 }),
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.reasons).toEqual([]);
  });
});
