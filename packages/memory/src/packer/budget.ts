/**
 * Token envelopes (FR-L8, R-I1): a literal per-window-class budget table —
 * instruction/working/emergency-stop tiers are copied verbatim from SRS
 * §2.5, never derived by arithmetic (60k's 15k + 38k = 53k, one short of
 * its own 54k emergency threshold — computing emergency from the other two
 * would silently drift from the spec). `resolveTokenEnvelope` picks the
 * largest tier whose `minWindowTokens` still fits under the model's actual
 * context window, so budget scales with the window instead of a fixed
 * default.
 */

export interface TokenEnvelope {
  readonly minWindowTokens: number;
  readonly instruction: number;
  readonly working: number;
  readonly emergency: number;
}

export const TOKEN_ENVELOPES: readonly TokenEnvelope[] = [
  { minWindowTokens: 32_000, instruction: 8_000, working: 20_000, emergency: 28_000 },
  { minWindowTokens: 60_000, instruction: 15_000, working: 38_000, emergency: 54_000 },
  { minWindowTokens: 100_000, instruction: 25_000, working: 65_000, emergency: 90_000 },
];

/**
 * No fixture exists below the 32k tier (FR-L8's table starts there); a
 * model window smaller than that gets the 32k tier as a documented
 * conservative floor rather than an invented smaller envelope.
 */
export function resolveTokenEnvelope(modelWindowTokens: number): TokenEnvelope {
  const fitting = TOKEN_ENVELOPES.filter(
    (tier) => tier.minWindowTokens <= modelWindowTokens,
  );
  return fitting.length > 0
    ? (fitting[fitting.length - 1] as TokenEnvelope)
    : (TOKEN_ENVELOPES[0] as TokenEnvelope);
}

/**
 * Per-expert instruction-cost accounting (FR-L8): the packer's own content
 * budget is the envelope's `working` tier minus whatever the calling
 * expert's fixed instruction text actually costs — never negative.
 */
export function workingBudgetAfterInstructionCost(
  envelope: TokenEnvelope,
  instructionCostTokens = 0,
): number {
  return Math.max(0, envelope.working - instructionCostTokens);
}
