/** RFC 7807 `application/problem+json` shape (API_DESIGN §1/§4). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  request_id: string;
  rule?: string;
}

export function problem(input: {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  rule?: string;
}): ProblemDetails {
  return {
    type: input.type,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    request_id: input.requestId,
    ...(input.rule ? { rule: input.rule } : {}),
  };
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
