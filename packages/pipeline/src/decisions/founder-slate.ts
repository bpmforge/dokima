/**
 * Founder-fork slate construction + the FR-P6 "must slate, never assume"
 * guard: "an agent that cannot decide a founder-owned fork must slate it,
 * never assume" (SRS FR-P6). `resolveFounderFork` is the mechanical form of
 * that rule — it has exactly two outcomes, and there is no third path where
 * a caller can silently pick a default: either the fork is already decided
 * (a real D-ID is on file) or a slate is handed back that MUST be shown to
 * the founder. Nothing in this module can return an assumed answer.
 */
import type { FounderSlate, FounderSlateOption } from './types.js';

export class InvalidFounderSlateError extends Error {
  constructor(reason: string) {
    super(
      `invalid founder slate: ${reason} (FR-P6 requires 2–4 options with a recommendation)`,
    );
    this.name = 'InvalidFounderSlateError';
  }
}

export interface FounderSlateInput {
  readonly title: string;
  readonly options: readonly FounderSlateOption[];
  readonly recommendedId: string;
  readonly recommendedReasoning: string;
}

/**
 * Builds a `FounderSlate`, enforcing FR-P6's "2–4 option cards ... one
 * Recommended" shape. Refuses (rather than clamping/padding) malformed
 * input — a slate with the wrong option count is not a smaller problem to
 * paper over, it is the agent failing to present a real choice.
 */
export function buildFounderSlate(input: FounderSlateInput): FounderSlate {
  if (input.options.length < 2 || input.options.length > 4) {
    throw new InvalidFounderSlateError(`got ${input.options.length} options, want 2–4`);
  }
  const ids = new Set(input.options.map((o) => o.id));
  if (ids.size !== input.options.length) {
    throw new InvalidFounderSlateError('option ids must be unique');
  }
  if (!ids.has(input.recommendedId)) {
    throw new InvalidFounderSlateError(
      `recommendedId "${input.recommendedId}" is not among the slate's options`,
    );
  }
  if (input.recommendedReasoning.trim().length === 0) {
    throw new InvalidFounderSlateError('recommendedReasoning must not be empty');
  }

  return {
    kind: 'founder',
    title: input.title,
    options: input.options,
    recommendedId: input.recommendedId,
    recommendedReasoning: input.recommendedReasoning,
  };
}

/** A founder-owned fork an agent has encountered, keyed stably across runs (e.g. `deployment-shape`). */
export interface ForkDescriptor {
  readonly key: string;
  readonly slate: FounderSlateInput;
}

export type ForkResolution =
  | { readonly status: 'decided'; readonly decisionId: string }
  | { readonly status: 'slate-required'; readonly slate: FounderSlate };

/**
 * The FR-P6 guard. `decided` maps fork keys to the D-ID that resolved them
 * (the wiring ticket populates this from `docs/DECISIONS.md`/the `decisions`
 * table). A key not present in the map is, by construction, undecided — the
 * function never falls back to `fork.slate.recommendedId` on the caller's
 * behalf; the recommendation is advisory content *inside* the slate the
 * founder reviews, not an auto-selected outcome.
 */
export function resolveFounderFork(
  fork: ForkDescriptor,
  decided: ReadonlyMap<string, string>,
): ForkResolution {
  const decisionId = decided.get(fork.key);
  if (decisionId !== undefined) {
    return { status: 'decided', decisionId };
  }
  return { status: 'slate-required', slate: buildFounderSlate(fork.slate) };
}
