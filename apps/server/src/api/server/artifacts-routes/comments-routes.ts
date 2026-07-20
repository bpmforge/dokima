/**
 * Artifact feedback-comment routes (FR-C8; UX_SPEC §5). Only this loop is
 * event-sourced: a comment is `artifact.comment_created`; a comment on a
 * deliverable that already has a gate/close receipt also appends
 * `revision.requested` (no producer for either event type exists anywhere
 * in the codebase yet — this route group is the first).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  appendEvent,
  listEvents,
  openEventLog,
  openEventLogReader,
  type EventLog,
} from '@shipwright/events';
import {
  EVENT_SEQ_HEADER,
  extractIdempotencyKey,
  IdempotencyStore,
} from '../../idempotency.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../board-actor.js';
import { PROBLEM_CONTENT_TYPE } from '../board-errors.js';
import { stateDbPath } from '../board-project.js';
import { badRequest } from '../artifacts-helpers.js';
import { problem } from '../../problem.js';
import {
  isGatedDeliverable,
  phaseForDeliverablePath,
  projectPathOrProblem,
  type ArtifactCommentPayload,
  type RevisionRequestedPayload,
} from './shared.js';

export function registerArtifactCommentRoutes(
  app: FastifyInstance,
  registryPath: string,
  idempotency: IdempotencyStore,
): void {
  app.get(
    '/api/v1/projects/:id/artifacts/comments',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOrProblem(request, reply, registryPath);
      if (!projectPath) return;
      const query = request.query as { path?: string };
      if (!query.path) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" is required'));
      }
      const db = openEventLogReader(stateDbPath(projectPath));
      try {
        const log: EventLog = {
          db,
          path: stateDbPath(projectPath),
          close: () => db.close(),
        };
        const events = listEvents(log);
        const comments = events
          .filter((e) => e.eventType === 'artifact.comment_created')
          .filter((e) => (e.payload as ArtifactCommentPayload).path === query.path)
          .map((e) => {
            const payload = e.payload as ArtifactCommentPayload;
            const revision = events.find(
              (r) =>
                r.eventType === 'revision.requested' &&
                (r.payload as RevisionRequestedPayload).commentEventSeq === e.seq,
            );
            return {
              seq: e.seq,
              at: e.createdAt,
              actorId: e.actorId,
              body: payload.body,
              versionRef: payload.versionRef,
              revisionRequested: Boolean(revision),
            };
          });
        return reply.send({ items: comments });
      } finally {
        db.close();
      }
    },
  );

  app.post(
    '/api/v1/projects/:id/artifacts/comments',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const projectPath = await projectPathOrProblem(request, reply, registryPath);
      if (!projectPath) return;
      const body = request.body as Partial<ArtifactCommentPayload> | undefined;
      if (
        !body?.path ||
        !body.body ||
        typeof body.body !== 'string' ||
        !body.versionRef
      ) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path", "body", and "versionRef" are required'));
      }
      const ticketId = body.ticketId ?? null;
      // SECURITY (W5-21): never trust a client-supplied `phase` for gating —
      // derive it server-side from the deliverable path (shared.ts).
      const phase = phaseForDeliverablePath(body.path);

      const idempotencyKey = extractIdempotencyKey(request.headers);
      const replayKey = idempotencyKey
        ? `${projectId}:comment:${idempotencyKey}`
        : undefined;
      if (replayKey) {
        const replay = idempotency.get(replayKey);
        if (replay) {
          return reply.code(replay.status).headers(replay.headers).send(replay.body);
        }
      }

      let log: EventLog;
      try {
        log = openEventLog(stateDbPath(projectPath));
      } catch (err) {
        return reply
          .code(503)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            problem({
              type: 'https://shipwright.dev/errors/db-busy',
              title: 'Project database busy',
              status: 503,
              detail: err instanceof Error ? err.message : String(err),
              instance: request.url,
              requestId: request.id.toString(),
            }),
          );
      }
      try {
        ensureOperatorIdentity(log);
        const commentEvent = appendEvent(log, {
          eventType: 'artifact.comment_created',
          actorId: OPERATOR_ACTOR_ID,
          ticketId,
          payload: {
            path: body.path,
            body: body.body,
            versionRef: body.versionRef,
            ticketId,
            phase,
          } satisfies ArtifactCommentPayload,
        });

        const gated = isGatedDeliverable(log.db, ticketId, body.path);
        let lastSeq = commentEvent.seq;
        if (gated) {
          const revisionEvent = appendEvent(log, {
            eventType: 'revision.requested',
            actorId: OPERATOR_ACTOR_ID,
            ticketId,
            payload: {
              path: body.path,
              commentEventSeq: commentEvent.seq,
              ticketId,
              phase,
              requestedBy: OPERATOR_ACTOR_ID,
            } satisfies RevisionRequestedPayload,
          });
          lastSeq = revisionEvent.seq;
        }

        const headers = { [EVENT_SEQ_HEADER]: String(lastSeq) };
        const responseBody = {
          comment: {
            seq: commentEvent.seq,
            at: commentEvent.createdAt,
            actorId: commentEvent.actorId,
            body: body.body,
            versionRef: body.versionRef,
            revisionRequested: gated,
          },
          revisionRequested: gated,
        };
        if (replayKey) {
          idempotency.put(replayKey, { status: 201, body: responseBody, headers });
        }
        return reply.code(201).headers(headers).send(responseBody);
      } finally {
        log.close();
      }
    },
  );
}
