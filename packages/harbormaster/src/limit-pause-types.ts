/**
 * Provider-limit park/resume types (BLUEPRINT §3.3/§3.6, FR-G8, ARCHITECTURE.md §8 "Provider
 * limit window"). `LimitClassification` mirrors `packages/gateway/src/limits/types.ts`'s
 * `ProviderErrorClassification` field-for-field by hand — not imported, because
 * `@shipwright/gateway`'s package.json only exports `.` → `src/index.ts`, which does not
 * (yet) re-export the `limits` module (that file is out of this ticket's write_scope,
 * `packages/gateway/src/limits/**`; the gap is the same one `packages/gateway/src/budget/
 * index.ts` documents for its own module, closed by a later ticket). Whoever wires this module
 * to a real `classifyProviderError` call should pass its return value straight through — the
 * shapes are kept in sync by convention until that export lands.
 */

export interface LimitBerthKey {
  readonly projectId: string;
  readonly runId: string;
  readonly ticketId?: string | null;
  readonly berthId: string;
  readonly providerId: string;
}

export type LimitErrorClass = 'limit' | 'terminal';

export interface LimitClassification {
  readonly class: LimitErrorClass;
  /** ISO-8601 resume timestamp from a stated provider reset time, when the classifier found one. Absent ⇒ this module's own backoff computes the resume time instead (FR-G8 acceptance: "harbormaster... auto-resumes at the computed time; exponential-backoff fallback capped at 60m"). */
  readonly resumeAt?: string;
}

/** How a pause's resumeAt was determined — distinct from a budget breaker's spend ratio (provider ceiling vs user ceiling, FR-G4 vs FR-G8). */
export type LimitResumeSource = 'stated' | 'backoff';

export interface LimitPauseRecord extends LimitBerthKey {
  readonly pausedAt: string;
  readonly resumeAt: string;
  readonly resumeSource: LimitResumeSource;
  /** Consecutive limit pauses this berth has hit with no intervening success — drives exponential backoff, reset to 0 the moment an attempt succeeds. */
  readonly attempt: number;
}
