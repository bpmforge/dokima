/**
 * Session-trace routes (UX_SPEC §4 "session trace link"; API_DESIGN "GET
 * /runs/{id}/trace?ticket= — session trace: events for replay UI"). Real
 * events, not fabricated: `packages/events`' `EventRecord` already carries
 * `runId`/`ticketId` (only the loop-engine CLI path sets `runId` today —
 * `apps/server/src/api/server/board-routes.ts`'s verb handlers never do, so
 * a board-only ticket honestly has no runs and the drawer's "session trace"
 * link stays hidden per C-1, same precedent as `receipts-routes.ts`'s
 * approvals-ledger). `GET /tickets/:id/runs` is this file's own addition
 * (not in API_DESIGN's catalog) — the minimal lookup the documented trace
 * endpoint needs to ever be reachable from a ticket, since no wire type
 * anywhere carries a ticket's run id(s).
 */

import type { EventRecord } from '@dokima/events';
import { listEvents, openEventLogReader } from '@dokima/events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { badRequest, notFound } from './artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';

export interface RunsRoutesOptions {
  /** Overrides `computeFleetRegistryPath()` — tests only. */
  home?: string;
}

function wireEvent(record: EventRecord) {
  return {
    seq: record.seq,
    event_type: record.eventType,
    actor_id: record.actorId,
    ticket_id: record.ticketId,
    run_id: record.runId,
    payload: record.payload,
    created_at: record.createdAt,
  };
}

export function registerRunsRoutes(
  app: FastifyInstance,
  opts: RunsRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  async function projectPathOr404(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
  ): Promise<string | undefined> {
    const record = await resolveProjectRecord(registryPath, projectId);
    if (!record) {
      await reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send(notFound(request, `no project registered with id ${projectId}`));
      return undefined;
    }
    return record.path;
  }

  /** `GET /api/v1/tickets/:id/runs?project=` — distinct run ids this ticket has events under. */
  app.get(
    '/api/v1/tickets/:id/runs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: ticketId } = request.params as { id: string };
      const query = request.query as { project?: string };
      if (!query.project) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"project" query param is required'));
      }
      const projectPath = await projectPathOr404(request, reply, query.project);
      if (!projectPath) return;

      const db = openEventLogReader(stateDbPath(projectPath));
      try {
        const log = { db, path: stateDbPath(projectPath), close: () => db.close() };
        const runIds = new Set<string>();
        for (const event of listEvents(log)) {
          if (event.ticketId === ticketId && event.runId) runIds.add(event.runId);
        }
        return reply.send({ items: Array.from(runIds) });
      } finally {
        db.close();
      }
    },
  );

  /** `GET /api/v1/runs/:id/trace?ticket=&project=` (API_DESIGN "session trace: events for replay UI"). */
  app.get(
    '/api/v1/runs/:id/trace',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: runId } = request.params as { id: string };
      const query = request.query as { project?: string; ticket?: string };
      if (!query.project) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"project" query param is required'));
      }
      const projectPath = await projectPathOr404(request, reply, query.project);
      if (!projectPath) return;

      const db = openEventLogReader(stateDbPath(projectPath));
      try {
        const log = { db, path: stateDbPath(projectPath), close: () => db.close() };
        const items = listEvents(log)
          .filter((event) => event.runId === runId)
          .filter((event) => !query.ticket || event.ticketId === query.ticket)
          .map(wireEvent);
        return reply.send({ items });
      } finally {
        db.close();
      }
    },
  );
}
