/**
 * Shared helpers for the notification-center + morning-queue routes —
 * fleet-wide project resolution, per-project state.db refresh, wire
 * mapping, and Problem+JSON error builders shared by every route chapter
 * (`./read-routes.ts`, `./decide-routes.ts`, `./emit-route.ts`).
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openEventLog, type EventLog } from '@shipwright/events';
import { loadTickets } from '@shipwright/tickets';
import type { FastifyRequest } from 'fastify';
import {
  listProjectCards,
  type ProjectCard,
  type ProjectRecord,
} from '../../projects.js';
import { problem } from '../../problem.js';
import {
  type ListNotificationsFilter,
  listNotifications,
  maybeEmitTrustGraduationSuggestion,
  type NotificationKind,
  type NotificationRecord,
  NOTIFICATION_STATUSES,
  type NotificationStatus,
  NOTIFICATION_TIERS,
  type NotificationTier,
  promoteEligibleNotifications,
} from '../../notifications/index.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../board-actor.js';
import { stateDbPath } from '../board-project.js';

export interface NotificationRoutesOptions {
  /** Fleet registry home dir override (defaults to computeShipwrightHome()) — tests only. */
  home?: string;
}

export interface NotificationWire {
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

export function toWire(
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
 *
 * The empty-array fallback is reserved for the one honest-empty case — a
 * state.db that predates this ticket's migration. Any other failure
 * (corrupt db, a bug in promotion/suggestion logic) rethrows so the caller
 * surfaces a 500 instead of a Decide notification silently vanishing from
 * the aggregated feed/queue.
 */
export async function refreshAndListProjectNotifications(
  project: Pick<ProjectRecord, 'id' | 'name' | 'path'>,
  filter: ListNotificationsFilter,
): Promise<NotificationWire[]> {
  const dbPath = stateDbPath(project.path);
  if (!(await pathExists(dbPath))) return [];

  let log: EventLog;
  try {
    log = openEventLog(dbPath);
  } catch (err) {
    if (isUnmigratedSchemaError(err)) return [];
    console.error(`[notifications] open failed for ${dbPath}:`, err);
    throw err;
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
    if (isUnmigratedSchemaError(err)) return [];
    console.error(`[notifications] refresh failed for ${dbPath}:`, err);
    throw err;
  } finally {
    log.close();
  }
}

export function isValidTier(value: unknown): value is NotificationTier {
  return (
    typeof value === 'string' && (NOTIFICATION_TIERS as readonly string[]).includes(value)
  );
}

export function isValidStatus(value: unknown): value is NotificationStatus {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

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

/** `undefined` project filter -> every registered (non-archived) project (FR-F4 aggregation default); a filter that matches nothing is a 404, not an empty list — same "unregistered id" contract as `GET /projects/:id/tickets`. */
export async function resolveTargetProjects(
  registryPath: string,
  projectFilter: string | undefined,
): Promise<{ projects: ProjectCard[]; notFound: boolean }> {
  const cards = await listProjectCards(registryPath, { archived: false });
  if (!projectFilter) return { projects: cards, notFound: false };
  const match = cards.filter((c) => c.id === projectFilter);
  return { projects: match, notFound: match.length === 0 };
}

export function byRecentDesc(a: NotificationWire, b: NotificationWire): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

export function byLeverageThenOldest(a: NotificationWire, b: NotificationWire): number {
  if (a.leverage !== b.leverage) return b.leverage - a.leverage;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}
