/**
 * Notification center + aggregated morning queue routes (API_DESIGN §2
 * "clarifications & approvals", UX_SPEC §7, FR-N4/FR-F4, US-404/US-704/
 * US-801). Fans `notifications.ts`'s per-project core out across every
 * registered project (D-013 Fleet, same aggregation shape as
 * `projects.ts`'s `listProjectCards` — reused here rather than
 * reimplemented) for the "one ten-minute review" cross-project queue.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { openEventLog, type EventLog } from '@shipwright/events';
import { loadTickets } from '@shipwright/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  computeFleetRegistryPath,
  listProjectCards,
  type ProjectCard,
  type ProjectRecord,
} from '../projects.js';
import { problem, PROBLEM_CONTENT_TYPE } from '../problem.js';
import {
  type ApprovalDecision,
  decideNotification,
  dismissNotification,
  emitNotification,
  emitReviewItem,
  listNotifications,
  type ListNotificationsFilter,
  maybeEmitTrustGraduationSuggestion,
  NOTIFICATION_KINDS,
  type NotificationKind,
  NotificationNotFoundError,
  NOTIFICATION_STATUSES,
  type NotificationRecord,
  type NotificationStatus,
  NotificationTaxonomyError,
  NOTIFICATION_TIERS,
  type NotificationTier,
  promoteEligibleNotifications,
} from '../notifications.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from './board-actor.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';

export interface NotificationRoutesOptions {
  /** Fleet registry home dir override (defaults to computeShipwrightHome()) — tests only. */
  home?: string;
}

interface NotificationWire {
  id: string;
  tier: NotificationTier;
  kind: NotificationKind;
  ref_type: string | null;
  ref_id: string | null;
  title: string;
  body: unknown;
  leverage: number;
  status: NotificationStatus;
  pushed_at: string | null;
  created_at: string;
  resolved_at: string | null;
  project_id: string;
  project_name: string;
}

function toWire(
  record: NotificationRecord,
  project: Pick<ProjectRecord, 'id' | 'name'>,
): NotificationWire {
  return {
    id: record.id,
    tier: record.tier,
    kind: record.kind,
    ref_type: record.refType,
    ref_id: record.refId,
    title: record.title,
    body: record.body,
    leverage: record.leverage,
    status: record.status,
    pushed_at: record.pushedAt,
    created_at: record.createdAt,
    resolved_at: record.resolvedAt,
    project_id: project.id,
    project_name: project.name,
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Mirrors `projects.ts`'s own check (not exported) — a state.db predating this ticket's migration degrades to empty, same as every other honest-empty fallback in this file's siblings (`estimate-routes.ts`). */
function isUnmigratedSchemaError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'SQLITE_ERROR' &&
    /no such table|no such column/.test(err.message)
  );
}

/**
 * Opens `project`'s state.db (write mode — `openEventLog` applies pending
 * migrations, self-healing an older db) and refreshes it before listing:
 * re-evaluates Decide push-promotion against current board state and
 * (idempotently) emits the trust-graduation suggestion once evidence
 * crosses threshold. No background scheduler (`packages/harbormaster`) is
 * reachable from apps/server's write_scope, so a `GET` here doubles as the
 * "rule" tick — safe to repeat since both operations are no-ops once
 * already applied (`promoteEligibleNotifications` skips already-pushed
 * rows; `maybeEmitTrustGraduationSuggestion` skips while a suggestion is
 * still open).
 */
async function refreshAndListProjectNotifications(
  project: Pick<ProjectRecord, 'id' | 'name' | 'path'>,
  filter: ListNotificationsFilter,
): Promise<NotificationWire[]> {
  const dbPath = stateDbPath(project.path);
  if (!(await pathExists(dbPath))) return [];

  let log: EventLog;
  try {
    log = openEventLog(dbPath);
  } catch (err) {
    console.error(`[notifications] open failed for ${dbPath}:`, err);
    return [];
  }
  try {
    ensureOperatorIdentity(log);
    const tickets = Array.from(loadTickets(log).values());
    maybeEmitTrustGraduationSuggestion(log, tickets, {
      id: `suggestion-${randomUUID()}`,
      actorId: OPERATOR_ACTOR_ID,
    });
    promoteEligibleNotifications(log, tickets, { actorId: OPERATOR_ACTOR_ID });
    return listNotifications(log, filter).map((record) => toWire(record, project));
  } catch (err) {
    if (!isUnmigratedSchemaError(err)) {
      console.error(`[notifications] refresh failed for ${dbPath}:`, err);
    }
    return [];
  } finally {
    log.close();
  }
}

function isValidTier(value: unknown): value is NotificationTier {
  return (
    typeof value === 'string' && (NOTIFICATION_TIERS as readonly string[]).includes(value)
  );
}

function isValidStatus(value: unknown): value is NotificationStatus {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

function notFoundProblem(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

/** `undefined` project filter -> every registered (non-archived) project (FR-F4 aggregation default); a filter that matches nothing is a 404, not an empty list — same "unregistered id" contract as `GET /projects/:id/tickets`. */
async function resolveTargetProjects(
  registryPath: string,
  projectFilter: string | undefined,
): Promise<{ projects: ProjectCard[]; notFound: boolean }> {
  const cards = await listProjectCards(registryPath, { archived: false });
  if (!projectFilter) return { projects: cards, notFound: false };
  const match = cards.filter((c) => c.id === projectFilter);
  return { projects: match, notFound: match.length === 0 };
}

function byRecentDesc(a: NotificationWire, b: NotificationWire): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

function byLeverageThenOldest(a: NotificationWire, b: NotificationWire): number {
  if (a.leverage !== b.leverage) return b.leverage - a.leverage;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** `GET /api/v1/notifications?tier=&project=&status=` (API_DESIGN §2, FR-F4 aggregated across projects; Record tier is feed-only per FR-N4 — it still lists here, just never in the morning queue). */
function registerListRoute(app: FastifyInstance, registryPath: string): void {
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
function registerQueueRoute(app: FastifyInstance, registryPath: string): void {
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

interface DecideBody {
  decision?: unknown;
  note?: unknown;
}

/** `POST /api/v1/approvals/:id/decide` — morning-queue Approve/Reject (UX_SPEC §7). */
function registerDecideRoute(app: FastifyInstance, registryPath: string): void {
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
function registerDismissRoute(app: FastifyInstance, registryPath: string): void {
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
function registerEmitRoute(app: FastifyInstance, registryPath: string): void {
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

/** Notification center + morning queue routes (module header). */
export function registerNotificationRoutes(
  app: FastifyInstance,
  opts: NotificationRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  registerListRoute(app, registryPath);
  registerQueueRoute(app, registryPath);
  registerDecideRoute(app, registryPath);
  registerDismissRoute(app, registryPath);
  registerEmitRoute(app, registryPath);
}

export { NOTIFICATION_KINDS, NOTIFICATION_STATUSES, NOTIFICATION_TIERS };
