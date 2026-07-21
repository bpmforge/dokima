import { describe, expect, it } from 'vitest';
import {
  resolveTokenEnvelope,
  workingBudgetAfterInstructionCost,
  TOKEN_ENVELOPES,
} from './budget.js';

describe('resolveTokenEnvelope', () => {
  it('returns the literal 32k tier (FR-L8 table, never derived arithmetic)', () => {
    expect(resolveTokenEnvelope(32_000)).toEqual({
      minWindowTokens: 32_000,
      instruction: 8_000,
      working: 20_000,
      emergency: 28_000,
    });
  });

  it('returns the literal 60k tier, whose emergency threshold is not instruction+working', () => {
    const tier = resolveTokenEnvelope(60_000);
    expect(tier).toEqual({
      minWindowTokens: 60_000,
      instruction: 15_000,
      working: 38_000,
      emergency: 54_000,
    });
    expect(tier.instruction + tier.working).not.toBe(tier.emergency);
  });

  it('returns the literal 100k+ tier for a window at or above 100k', () => {
    expect(resolveTokenEnvelope(100_000)).toEqual({
      minWindowTokens: 100_000,
      instruction: 25_000,
      working: 65_000,
      emergency: 90_000,
    });
    expect(resolveTokenEnvelope(1_000_000).minWindowTokens).toBe(100_000);
  });

  it('picks the largest tier that still fits under a window between two thresholds', () => {
    expect(resolveTokenEnvelope(45_000).minWindowTokens).toBe(32_000);
    expect(resolveTokenEnvelope(99_999).minWindowTokens).toBe(60_000);
  });

  it('falls back to the 32k floor tier for a window below any fixture (documented conservative default)', () => {
    expect(resolveTokenEnvelope(8_000)).toBe(TOKEN_ENVELOPES[0]);
  });
});

describe('workingBudgetAfterInstructionCost', () => {
  const envelope = resolveTokenEnvelope(32_000);

  it('subtracts the expert instruction cost from the working tier', () => {
    expect(workingBudgetAfterInstructionCost(envelope, 3_000)).toBe(17_000);
  });

  it('defaults to the full working tier when no instruction cost is given', () => {
    expect(workingBudgetAfterInstructionCost(envelope)).toBe(20_000);
  });

  it('never goes negative even when instruction cost exceeds the working tier', () => {
    expect(workingBudgetAfterInstructionCost(envelope, 999_999)).toBe(0);
  });
});
