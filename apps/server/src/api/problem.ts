/**
 * RFC 7807 `application/problem+json` shape (API_DESIGN §1/§4). Invariant
 * refusals carry `rule` (the specific check that fired) and `evidence`
 * (whatever the caller needs to render "explain this refusal" verbatim —
 * receipt ids, exit codes, file paths — FR-T4); both are optional because
 * plain auth/validation refusals (401/403/generic 400) have no rule or
 * evidence to cite, only a reason.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  request_id: string;
  rule?: string;
  evidence?: Record<string, unknown>;
}

export function problem(input: {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  rule?: string;
  evidence?: Record<string, unknown>;
}): ProblemDetails {
  return {
    type: input.type,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    request_id: input.requestId,
    ...(input.rule ? { rule: input.rule } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
