import { describe, expect, it } from 'vitest';
import { rollupSuppressionVolume } from './suppressionDigest.js';
import type { SuppressionRecord } from './types.js';

describe('rollupSuppressionVolume', () => {
  it('empty records yields an empty rollup', () => {
    expect(rollupSuppressionVolume([])).toEqual([]);
  });

  it('counts suppressions per rule, descending by volume (GATE_ECONOMICS §3 demotion input)', () => {
    const records: SuppressionRecord[] = [
      { ruleId: 'no-magic-numbers', fingerprint: 'f1', justification: 'false_positive' },
      { ruleId: 'no-magic-numbers', fingerprint: 'f2', justification: 'false_positive' },
      { ruleId: 'no-magic-numbers', fingerprint: 'f3', justification: 'accepted_risk' },
      {
        ruleId: 'no-unreachable',
        fingerprint: 'f4',
        justification: 'not_applicable_scope',
      },
    ];
    expect(rollupSuppressionVolume(records)).toEqual([
      { ruleId: 'no-magic-numbers', count: 3 },
      { ruleId: 'no-unreachable', count: 1 },
    ]);
  });

  it('ties break by ruleId ascending for a deterministic order', () => {
    const records: SuppressionRecord[] = [
      { ruleId: 'zeta-rule', fingerprint: 'f1', justification: 'wont_fix_documented' },
      { ruleId: 'alpha-rule', fingerprint: 'f2', justification: 'fixed_elsewhere' },
    ];
    expect(rollupSuppressionVolume(records).map((r) => r.ruleId)).toEqual([
      'alpha-rule',
      'zeta-rule',
    ]);
  });
});
