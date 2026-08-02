import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem, PROBLEM_CONTENT_TYPE } from '../problem.js';
import { ProjectNotFoundError, resolveProjectPath } from './settings-db.js';

/** Resolves `:id` to a project directory, or sends an RFC 7807 404 and returns undefined. */
export async function resolveProjectOrProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  home?: string,
): Promise<string | undefined> {
  try {
    return await resolveProjectPath(id, home);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      await reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problem({
            type: 'https://dokima.dev/errors/not-found',
            title: 'Project not found',
            status: 404,
            detail: err.message,
            instance: request.url,
            requestId: request.id.toString(),
          }),
        );
      return undefined;
    }
    throw err;
  }
}

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

/** D-019: consent-gated keys refused on the generic settings PUT (see scope-routes.ts's CONSENT_GATED_KEYS). */
export function forbidden(request: FastifyRequest, detail: string, rule?: string) {
  return problem({
    type: 'https://dokima.dev/errors/forbidden',
    title: 'Forbidden',
    status: 403,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
    rule,
  });
}

/** API_DESIGN §1: invariant refusals return 409 with the specific rule named. */
export function conflict(request: FastifyRequest, detail: string, rule?: string) {
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
