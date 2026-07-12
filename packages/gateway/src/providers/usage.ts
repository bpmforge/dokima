import type { NormalizedUsage } from './types.js';

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

/** Keyed by model id. A model absent from the table costs $0 (local models: metered, never priced). */
export type CostTable = Record<string, ModelPrice>;

/** No entries — every model is $0, which is exactly "local = $0 but metered" (FR-G1). */
export const LOCAL_COST_TABLE: CostTable = {};

export interface RawUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Tokens in/out → cost via the price table; unpriced models (typically local) cost $0. */
export function normalizeUsage(
  raw: RawUsage,
  modelId: string,
  costTable: CostTable,
): NormalizedUsage {
  const price = costTable[modelId];
  const costUsd = price
    ? (raw.promptTokens / 1_000_000) * price.inputPerMillion +
      (raw.completionTokens / 1_000_000) * price.outputPerMillion
    : 0;
  return {
    promptTokens: raw.promptTokens,
    completionTokens: raw.completionTokens,
    totalTokens: raw.promptTokens + raw.completionTokens,
    costUsd,
  };
}
