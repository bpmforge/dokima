/**
 * Artifact Viewer routes (FR-C3, FR-C8; UX_SPEC §5). `doc-diff` diffs two
 * arbitrary revisions of one path directly (vs. `diff`'s ticket-branch-vs-
 * base comparison) — the client uses it to render "the revised version as a
 * diff against the commented version" per FR-C8/R-H2, with `from` set to
 * the comment's `versionRef`.
 *
 * Deliverables are not a
 * DB entity — "Docs live on disk in the project repo — the viewer is a
 * window onto git-visible files" (FR-C3) — so listing/reading/diffing goes
 * through `git-read.ts` against the project's own working copy. Only the
 * feedback-comment loop (FR-C8) is event-sourced: a comment is
 * `artifact.comment_created`; a comment on a deliverable that already has a
 * gate/close receipt also appends `revision.requested` (no producer for
 * either event type exists anywhere in the codebase yet — this route group
 * is the first).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  appendEvent,
  listEvents,
  openEventLog,
  openEventLogReader,
  type EventLog,
} from '@shipwright/events';
import { computeFleetRegistryPath } from '../projects.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from './board-actor.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';
import {
  defaultBaseBranch,
  findTicketBranch,
  listMarkdownFiles,
  logForPath,
  mergeBase,
  readWorkingTree,
  showAtRev,
} from './git-read.js';
import { problem } from '../problem.js';
import {
  titleFromMarkdown,
  isSafeRelativePath,
  notFound,
  badRequest,
} from './artifacts-helpers.js';

const DOCS_SUBDIR = 'docs';

interface ArtifactCommentPayload {
  path: string;
  body: string;
  versionRef: string;
  ticketId?: string | null;
  phase?: number | null;
}

interface RevisionRequestedPayload {
  path: string;
  commentEventSeq: number;
  ticketId?: string | null;
  phase?: number | null;
  requestedBy: string;
}

/** Does a gate/close receipt already exist for this ticket or phase (i.e. is the deliverable "gated")? */
function isGatedDeliverable(
  db: EventLog['db'],
  ticketId: string | null,
  phase: number | null,
): boolean {
  if (!ticketId && phase == null) return false;
  const row = db
    .prepare<[string | null, number | null, number | null], { id: string }>(
      `SELECT id FROM receipts
       WHERE kind IN ('gate', 'close')
         AND ((ticket_id IS NOT NULL AND ticket_id = ?) OR (? IS NOT NULL AND phase = ?))
       LIMIT 1`,
    )
    .get(ticketId, phase, phase);
  return Boolean(row);
}

export interface ArtifactRoutesOptions {
  /** Overrides `computeFleetRegistryPath()` — tests only. */
  home?: string;
}

export function registerArtifactRoutes(
  app: FastifyInstance,
  opts: ArtifactRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  async function projectPathOr404(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | undefined> {
    const { id } = request.params as { id: string };
    const record = await resolveProjectRecord(registryPath, id);
    if (!record) {
      await reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send(notFound(request, `no project registered with id ${id}`));
      return undefined;
    }
    return record.path;
  }

  app.get(
    '/api/v1/projects/:id/artifacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOr404(request, reply);
      if (!projectPath) return;
      const files = await listMarkdownFiles(projectPath, DOCS_SUBDIR);
      const items = await Promise.all(
        files.map(async (filePath) => {
          const content = await readWorkingTree(projectPath, filePath);
          return {
            path: filePath,
            title: titleFromMarkdown(
              content ?? '',
              filePath.split('/').pop() ?? filePath,
            ),
          };
        }),
      );
      return reply.send({ items });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/doc',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOr404(request, reply);
      if (!projectPath) return;
      const query = request.query as { path?: string; rev?: string };
      if (!query.path || !isSafeRelativePath(query.path)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" (safe relative path) is required'));
      }
      const versions = await logForPath(projectPath, query.path);
      const content = query.rev
        ? await showAtRev(projectPath, query.rev, query.path)
        : await readWorkingTree(projectPath, query.path);
      if (content === null) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            notFound(
              request,
              `no artifact at ${query.path}${query.rev ? `@${query.rev}` : ''}`,
            ),
          );
      }
      return reply.send({
        path: query.path,
        content,
        rev: query.rev ?? versions[0]?.rev ?? null,
        versions,
      });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/diff',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOr404(request, reply);
      if (!projectPath) return;
      const query = request.query as { path?: string; ticket?: string };
      if (!query.path || !isSafeRelativePath(query.path) || !query.ticket) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" and "ticket" are required'));
      }
      const branch = await findTicketBranch(projectPath, query.ticket);
      if (!branch) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no branch found for ticket ${query.ticket}`));
      }
      const base = await defaultBaseBranch(projectPath);
      const baseRev = (await mergeBase(projectPath, base, branch)) ?? base;
      const [oldContent, newContent] = await Promise.all([
        showAtRev(projectPath, baseRev, query.path),
        showAtRev(projectPath, branch, query.path),
      ]);
      return reply.send({
        path: query.path,
        ticket: query.ticket,
        branch,
        base,
        oldContent: oldContent ?? '',
        newContent: newContent ?? '',
      });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/doc-diff',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOr404(request, reply);
      if (!projectPath) return;
      const query = request.query as { path?: string; from?: string; to?: string };
      if (!query.path || !isSafeRelativePath(query.path) || !query.from) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" and "from" are required'));
      }
      const oldContent = await showAtRev(projectPath, query.from, query.path);
      if (oldContent === null) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no artifact at ${query.path}@${query.from}`));
      }
      const newContent = query.to
        ? await showAtRev(projectPath, query.to, query.path)
        : await readWorkingTree(projectPath, query.path);
      return reply.send({
        path: query.path,
        from: query.from,
        to: query.to ?? 'HEAD',
        oldContent,
        newContent: newContent ?? '',
      });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/comments',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOr404(request, reply);
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
      const projectPath = await projectPathOr404(request, reply);
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
      const phase = body.phase ?? null;

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

        const gated = isGatedDeliverable(log.db, ticketId, phase);
        if (gated) {
          appendEvent(log, {
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
        }

        return reply.code(201).send({
          comment: {
            seq: commentEvent.seq,
            at: commentEvent.createdAt,
            actorId: commentEvent.actorId,
            body: body.body,
            versionRef: body.versionRef,
            revisionRequested: gated,
          },
          revisionRequested: gated,
        });
      } finally {
        log.close();
      }
    },
  );
}
