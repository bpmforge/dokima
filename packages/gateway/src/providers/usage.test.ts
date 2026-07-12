import { describe, expect, it } from 'vitest';
import { LOCAL_COST_TABLE, normalizeUsage, type CostTable } from './usage.js';

describe('normalizeUsage', () => {
  it('local = $0 but tokens are still metered (FR-G1)', () => {
    const usage = normalizeUsage(
      { promptTokens: 1000, completionTokens: 500 },
      'qwen2.5-coder-7b-instruct',
      LOCAL_COST_TABLE,
    );
    expect(usage).toEqual({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      costUsd: 0,
    });
  });

  it('prices a known model from the cost table', () => {
    const costTable: CostTable = {
      'gpt-fixture': { inputPerMillion: 3, outputPerMillion: 15 },
    };
    const usage = normalizeUsage(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      'gpt-fixture',
      costTable,
    );
    expect(usage.costUsd).toBeCloseTo(18, 10);
  });

  it('an unpriced model in a non-empty table still costs $0, never NaN or a throw', () => {
    const costTable: CostTable = {
      'gpt-fixture': { inputPerMillion: 3, outputPerMillion: 15 },
    };
    const usage = normalizeUsage(
      { promptTokens: 10, completionTokens: 10 },
      'unlisted-model',
      costTable,
    );
    expect(usage.costUsd).toBe(0);
    expect(usage.totalTokens).toBe(20);
  });
});
