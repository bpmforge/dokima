/**
 * Provider-limit classification types (BLUEPRINT §3.3, FR-G8, ARCHITECTURE.md §8 "Provider
 * limit window"). Distinct from `../budget/types.ts`'s breaker types by construction: budget
 * tracks USD spend against a *user*-set ceiling, this module classifies a provider response
 * against the *provider's own* session/usage/rate-limit ceiling — no cost, no ledger entry,
 * no approval card ever attaches here (a limit pause is Record tier, never Decide).
 */

export type ProviderErrorClass = 'limit' | 'terminal';

export interface ProviderErrorClassification {
  readonly class: ProviderErrorClass;
  /**
   * ISO-8601 timestamp the caller should resume at, present only when the provider's own
   * response stated a reset time we could parse (e.g. "resets 10:10pm" — FR-G8). Absent on
   * 'terminal' errors, and absent on 'limit' errors that gave no stated reset time — callers
   * fall back to their own backoff schedule in that case (see `packages/harbormaster/src/
   * limit-pause.ts`, which owns that fallback since it — not this stateless classifier — is
   * what tracks repeated-attempt state per berth).
   */
  readonly resumeAt?: string;
}
