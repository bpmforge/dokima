/**
 * `POST /api/v1/projects/:id/notifications` — the emitter contract (US-704
 * AC-1: "Emitting an unclassified notification is an API-level error").
 */

import { randomUUID } from 'node:crypto';
import { openEventLog } from '@dokima/events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  emitNotification,
  emitReviewItem,
  type NotificationKind,
  NotificationTaxonomyError,
  type NotificationTier,
} from '../../notifications/index.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../board-actor.js';
import { resolveProjectRecord, stateDbPath } from '../board-project.js';
import { badRequest, notFoundProblem, toWire } from './shared.js';

interface EmitBody {
  tier?: unknown;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  summary?: unknown;
  ref_type?: unknown;
  ref_id?: unknown;
  leverage?: unknown;
}

/**
 * `POST /api/v1/projects/:id/notifications` — the emitter contract (US-704
 * AC-1: "Emitting an unclassified notification is an API-level error").
 * `tier: 'review'` always batches into the project's open digest
 * (`emitReviewItem`, UX_SPEC §7 "one notification per batch"); every other
 * tier creates its own card via `emitNotification`.
 */
export function registerEmitRoute(app: FastifyInstance, registryPath: string): void {
  app.post(
    '/api/v1/projects/:id/notifications',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFoundProblem(request, `no project registered with id ${projectId}`));
      }
      const body = (request.body ?? {}) as EmitBody;
      if (typeof body.title !== 'string' || body.title.trim() === '') {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"title" (non-empty string) is required'));
      }
      const refType = typeof body.ref_type === 'string' ? body.ref_type : null;
      const refId = typeof body.ref_id === 'string' ? body.ref_id : null;
      const leverage = typeof body.leverage === 'number' ? body.leverage : undefined;

      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        const created =
          body.tier === 'review'
            ? emitReviewItem(
                log,
                {
                  kind: body.kind as NotificationKind,
                  refType,
                  refId,
                  title: body.title,
                  summary: typeof body.summary === 'string' ? body.summary : '',
                  leverage,
                },
                { id: randomUUID(), actorId: OPERATOR_ACTOR_ID },
              )
            : emitNotification(log, {
                id: randomUUID(),
                tier: body.tier as NotificationTier,
                kind: body.kind as NotificationKind,
                refType,
                refId,
                title: body.title,
                body: body.body,
                leverage,
                actorId: OPERATOR_ACTOR_ID,
              });
        return reply.code(201).send(toWire(created, record));
      } catch (err) {
        if (err instanceof NotificationTaxonomyError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );
}
