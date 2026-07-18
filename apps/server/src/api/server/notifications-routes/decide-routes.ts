/**
 * `POST /api/v1/approvals/:id/decide` and
 * `POST /api/v1/notifications/:id/dismiss` — the two resolve routes on an
 * already-open notification (UX_SPEC §7).
 */

import { openEventLog } from '@shipwright/events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  type ApprovalDecision,
  decideNotification,
  dismissNotification,
  NotificationNotFoundError,
} from '../../notifications/index.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../board-actor.js';
import { resolveProjectRecord, stateDbPath } from '../board-project.js';
import { badRequest, notFoundProblem } from './shared.js';

interface DecideBody {
  decision?: unknown;
  note?: unknown;
}

/** `POST /api/v1/approvals/:id/decide` — morning-queue Approve/Reject (UX_SPEC §7). */
export function registerDecideRoute(app: FastifyInstance, registryPath: string): void {
  app.post(
    '/api/v1/approvals/:id/decide',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectId = (request.query as Record<string, unknown>).project;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required "project" query parameter'));
      }
      const body = (request.body ?? {}) as DecideBody;
      if (body.decision !== 'approved' && body.decision !== 'rejected') {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'body.decision must be "approved" or "rejected"'));
      }
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFoundProblem(request, `no project registered with id ${projectId}`));
      }
      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        decideNotification(log, id, body.decision as ApprovalDecision, {
          actorId: OPERATOR_ACTOR_ID,
          note: typeof body.note === 'string' ? body.note : undefined,
        });
        return reply.send({ id, status: 'done', decision: body.decision });
      } catch (err) {
        if (err instanceof NotificationNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFoundProblem(request, err.message));
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );
}

/** `POST /api/v1/notifications/:id/dismiss` — notification-center dismiss (Review/Record; also usable to wave off a Decide item without deciding). */
export function registerDismissRoute(app: FastifyInstance, registryPath: string): void {
  app.post(
    '/api/v1/notifications/:id/dismiss',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectId = (request.query as Record<string, unknown>).project;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required "project" query parameter'));
      }
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFoundProblem(request, `no project registered with id ${projectId}`));
      }
      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        dismissNotification(log, id, { actorId: OPERATOR_ACTOR_ID });
        return reply.send({ id, status: 'dismissed' });
      } catch (err) {
        if (err instanceof NotificationNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFoundProblem(request, err.message));
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );
}
