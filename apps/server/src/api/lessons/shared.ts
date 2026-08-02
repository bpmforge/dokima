import type { FastifyRequest } from 'fastify';
import { problem } from '../problem.js';

export function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

export function notFoundProblem(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

/** Field-report refusals (already-triaged, self-triage, duplicate ticket id) return 409 with the specific rule named (FR-T4 "explain-this-refusal", same convention as decisions/shared.ts). */
export function conflictProblem(request: FastifyRequest, detail: string, rule?: string) {
  return problem({
    type: 'https://dokima.dev/errors/conflict',
    title: 'Refused',
    status: 409,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
    rule,
  });
}
