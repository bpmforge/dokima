/**
 * `GET /api/v1/notifications` (notification center feed) and
 * `GET /api/v1/approvals/queue` (morning queue) — the two read routes
 * (API_DESIGN §2, UX_SPEC §7, FR-F4).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import type { ListNotificationsFilter } from '../../notifications/index.js';
import {
  badRequest,
  byLeverageThenOldest,
  byRecentDesc,
  isValidStatus,
  isValidTier,
  notFoundProblem,
  refreshAndListProjectNotifications,
  resolveTargetProjects,
} from './shared.js';

/** `GET /api/v1/notifications?tier=&project=&status=` (API_DESIGN §2, FR-F4 aggregated across projects; Record tier is feed-only per FR-N4 — it still lists here, just never in the morning queue). */
export function registerListRoute(app: FastifyInstance, registryPath: string): void {
  app.get(
    '/api/v1/notifications',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown>;
      if (query.tier !== undefined && !isValidTier(query.tier)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'tier must be one of decide|review|record'));
      }
      if (query.status !== undefined && !isValidStatus(query.status)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'status must be one of open|done|dismissed'));
      }
      const projectFilter = typeof query.project === 'string' ? query.project : undefined;
      const { projects, notFound } = await resolveTargetProjects(
        registryPath,
        projectFilter,
      );
      if (notFound) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            notFoundProblem(request, `no project registered with id ${projectFilter}`),
          );
      }

      const filter: ListNotificationsFilter = {
        tier: isValidTier(query.tier) ? query.tier : undefined,
        status: isValidStatus(query.status) ? query.status : 'open',
        orderBy: 'recent',
      };
      const results = await Promise.all(
        projects.map((project) => refreshAndListProjectNotifications(project, filter)),
      );
      const items = results.flat().sort(byRecentDesc);
      return reply.send({ items, next_cursor: null });
    },
  );
}

/** `GET /api/v1/approvals/queue?project=` — the morning queue (UX_SPEC §7): Decide + Review only (Record is feed-only), leverage-sorted, aggregated across projects by default (FR-F4). */
export function registerQueueRoute(app: FastifyInstance, registryPath: string): void {
  app.get(
    '/api/v1/approvals/queue',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown>;
      const projectFilter = typeof query.project === 'string' ? query.project : undefined;
      const { projects, notFound } = await resolveTargetProjects(
        registryPath,
        projectFilter,
      );
      if (notFound) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            notFoundProblem(request, `no project registered with id ${projectFilter}`),
          );
      }

      const results = await Promise.all(
        projects.map((project) =>
          refreshAndListProjectNotifications(project, {
            status: 'open',
            orderBy: 'leverage',
          }),
        ),
      );
      const items = results
        .flat()
        .filter((n) => n.tier === 'decide' || n.tier === 'review')
        .sort(byLeverageThenOldest);
      return reply.send({ items, next_cursor: null });
    },
  );
}
