import type { FastifyRequest } from 'fastify';
import { problem } from '../problem.js';

export function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

export function notFoundProblem(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

/** API_DESIGN §1: invariant refusals (already-decided slate, invalid choice) return 409 with the specific rule named. */
export function conflictProblem(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/conflict',
    title: 'Refused',
    status: 409,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}
