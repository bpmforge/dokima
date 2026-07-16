import type { ProblemDetails } from './types.js';

/**
 * "explain-this-refusal" (UX_SPEC §4, FR-T4): a rejected drag renders the
 * problem+json payload verbatim, never a bare "action failed". The rule
 * name (SRS FR id or SC id, e.g. `FR-T2`) is shown alongside the human
 * detail; evidence is surfaced when the server attaches it.
 */
export interface RefusalExplanation {
  rule: string;
  message: string;
  evidence: unknown;
  /** True when the payload names a concrete fixing affordance (API_DESIGN evidence.fix). */
  hasFix: boolean;
}

function extractFix(evidence: unknown): string | undefined {
  if (typeof evidence !== 'object' || evidence === null) return undefined;
  const fix = (evidence as Record<string, unknown>).fix;
  return typeof fix === 'string' ? fix : undefined;
}

export function explainRefusal(problem: ProblemDetails): RefusalExplanation {
  return {
    rule: problem.rule ?? problem.title,
    message: problem.detail,
    evidence: problem.evidence ?? null,
    hasFix: extractFix(problem.evidence) !== undefined,
  };
}

export function refusalFixAffordance(problem: ProblemDetails): string | undefined {
  return extractFix(problem.evidence);
}

export function isRefusal(status: number): boolean {
  return status === 409;
}
