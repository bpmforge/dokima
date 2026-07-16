/**
 * Maker != verifier for the Challenger role (W2-05, FR-G2, BLUEPRINT §3.3): "the maker's model
 * never reviews its own work." `packages/gateway/src/routing/maker-verifier.ts` already enforces
 * this generally for any verifier role via `guardMakerVerifierDistinct`; that package is out of
 * reach here for the same write_scope-boundary reason documented in `rerun.ts` (no declared
 * workspace dependency is possible from `packages/pipeline/src/challenger/**` alone). The
 * Challenger has no legitimate override path (unlike the general routing guard, which allows an
 * explicit per-role settings override) — a challenge is a veracity gate, and letting the maker's
 * model grade its own claim would defeat the point of running one at all, so this refusal is
 * unconditional.
 */

export class ChallengerSameModelError extends Error {
  constructor(
    public readonly claimId: string,
    public readonly model: string,
  ) {
    super(
      `refusing to challenge claim "${claimId}" with model "${model}" — same model as the maker ` +
        '(W2-05 maker != verifier; the Challenger role has no override path)',
    );
    this.name = 'ChallengerSameModelError';
  }
}

export interface ModelIdentityInput {
  readonly claimId: string;
  readonly challengerModel: string;
  readonly makerModel: string;
}

/** Throws `ChallengerSameModelError` when the challenger would grade the maker's own model's work. */
export function assertChallengerModelDistinct(input: ModelIdentityInput): void {
  if (input.challengerModel === input.makerModel) {
    throw new ChallengerSameModelError(input.claimId, input.challengerModel);
  }
}
