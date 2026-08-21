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
import {
  appendEvent,
  createIdentity,
  listEvents,
  openEventLog,
  openEventLogReader,
} from '@dokima/events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { badRequest, notFound } from './artifacts-helpers.js';
import { conflict } from './settings-route-helpers.js';
import { resolveSigningKey } from '../../cli/signing-key.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';
import {
  buildRunStatus,
  executeBuildRunJob,
  requestBuildRunStop,
} from './runs-job.js';
import { stopRun } from '@dokima/harbormaster';

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
  /**
   * POST .../build-runs — START the work (W12-20). Returns 202 with a run id;
   * the job runs off the request and progress is read from the event log the
   * trace route already serves.
   */
  app.post(
    '/api/v1/projects/:id/build-runs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await projectPathOr404(request, reply, id);
      if (!projectPath) return reply;
      const body = (request.body ?? {}) as { actor_id?: string; run_id?: string };
      const actorId = body.actor_id ?? 'operator';
      const runId = body.run_id ?? `run-${Date.now().toString(36)}`;

      /**
       * REFUSE BEFORE ACCEPTING (W12-40). `executeBuildRun` already declines an
       * unset `DOKIMA_SIGNING_KEY` — the close gate mints signed receipts and
       * will not mint unverifiable ones — but it declines INSIDE the job, so
       * the refusal reached the caller only through a later status poll.
       *
       * That made W12-20's Start-run button depend on a terminal step taken
       * before the process booted, with no surface anywhere to set it, and
       * fail in a way that looks like it should have worked. A 202 is a
       * promise to try; issuing one for work the server can already prove
       * cannot proceed is a spinner that ends in silence for any client that
       * does not poll.
       *
       * The key is readable now, so the answer is available now. Checked here
       * AND still checked in the job: this route is not the only caller (the
       * CLI path goes straight to `executeBuildRun`), and a precondition only
       * one entrance enforces is not a precondition.
       *
       * NOT a key-entry UI — minting or storing a signing key is a credential
       * path (Law 8) and belongs with the vault work. Filed as W12-43.
       */
      try {
        // W12-43: this used to refuse whenever the env var was unset, and tell
        // the user to restart the core with it — a terminal step for a secret
        // only `randomBytes` can sensibly produce. It now MINTS one on a fresh
        // install. What still refuses is the dangerous case, and only that
        // one: a project holding receipts whose key has gone missing, where a
        // replacement would silently invalidate every receipt it already has.
        const db = openEventLogReader(stateDbPath(projectPath));
        try {
          const row = db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as {
            n: number;
          };
          await resolveSigningKey({ receiptCount: row?.n ?? 0 });
        } finally {
          db.close();
        }
      } catch (err) {
        return reply
          .code(409)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            conflict(
              request,
              err instanceof Error ? err.message : String(err),
              'signing-key-unset',
            ),
          );
      }

      // Deliberately not awaited: a build run claims tickets, spawns agent
      // sessions and re-runs gates. Holding the request open for that is the
      // shape W10-58 removed from the creation path.
      void executeBuildRunJob({
        projectPath,
        projectId: id,
        actorId,
        runId,
        now: () => new Date().toISOString(),
      });
      return reply.code(202).send({ run_id: runId, status: 'running' });
    },
  );

  /**
   * W17-06: POST .../build-runs/:runId/stop — the safety control the live
   * UAT lacked. The loop stops at its next ticket boundary; in-flight work
   * finishes or parks honestly. Ledgered with who asked.
   */
  app.post(
    '/api/v1/projects/:id/build-runs/:runId/stop',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, runId } = request.params as { id: string; runId: string };
      const projectPath = await projectPathOr404(request, reply, id);
      if (!projectPath) return reply;
      const body = (request.body ?? {}) as { actor_id?: string };
      const actorId = body.actor_id ?? 'operator';

      const outcome = requestBuildRunStop(runId, actorId);
      if (outcome === 'unknown') {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no build run ${runId}`));
      }
      if (outcome === 'already') {
        return reply
          .code(409)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            conflict(request, `build run ${runId} is already stopping`, 'already-stopping'),
          );
      }

      const log = openEventLog(stateDbPath(projectPath));
      try {
        // events.actor_id is FK-enforced; the stopper may be a new identity.
        try {
          createIdentity(log, { id: actorId, name: actorId, kind: 'human' });
        } catch {
          // already exists — fine.
        }
        appendEvent(log, {
          eventType: 'run.stop_requested',
          actorId,
          runId,
          payload: { by: actorId },
        });
        // The REAL verb, when this run has a record (CLI-born runs do);
        // route-born runs have none and the flag+event are the stop.
        try {
          stopRun(log, runId, actorId, { now: () => new Date().toISOString() });
        } catch {
          // RunNotFound for route-born runs — normal, tolerated.
        }
      } finally {
        log.close();
      }
      return reply
        .code(202)
        .send({ run_id: runId, status: 'stopping', stops_at: 'next ticket boundary' });
    },
  );

  /**
   * GET .../build-runs/:runId — the refusals `executeBuildRun` produces are
   * things a user can act on (no signing key, unreadable vault, an
   * unconstructible provider, a pinned policy the land loop cannot honour).
   * Before this they only ever reached a stderr nobody was watching.
   */
  app.get(
    '/api/v1/projects/:id/build-runs/:runId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, runId } = request.params as { id: string; runId: string };
      const projectPath = await projectPathOr404(request, reply, id);
      if (!projectPath) return reply;
      const outcome = buildRunStatus(runId);
      if (outcome === undefined) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no build run ${runId}`));
      }
      if (outcome === 'running') return reply.send({ run_id: runId, status: 'running' });
      return reply.send({
        run_id: runId,
        status: outcome.exitCode === 0 ? 'finished' : 'refused',
        exit_code: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      });
    },
  );

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
