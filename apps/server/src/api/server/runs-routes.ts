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
import { listEvents, openEventLog, openEventLogReader } from '@dokima/events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { badRequest, notFound } from './artifacts-helpers.js';
import { conflict } from './settings-route-helpers.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';
import { executeBuildRun } from '../../cli/run-build.js';

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

/**
 * A build run, executed OFF the request (W12-20).
 *
 * WHY THIS EXISTS: every configuration surface in this product is a GUI and
 * the one action that matters was a terminal command. `runs-routes.ts` served
 * only `GET .../runs` and `GET /runs/:id/trace` — both read-only — so a user
 * could register providers, choose a model policy, watch the board and replay
 * a trace, and had no way to START the work from the product.
 *
 * OFF THE REQUEST, not held on it: a build run claims tickets, spawns agent
 * sessions and re-runs gates, which is minutes to hours. W10-58 already moved
 * the creation pipeline off a held HTTP request for the same reason and this
 * reuses that shape — 202 with a run id, progress read from the durable
 * channels (the event log the trace route already serves), never from a live
 * response.
 *
 * REUSES `executeBuildRun` RATHER THAN REIMPLEMENTING THE LOOP. That function
 * already owns the refusal set a user needs to see — unset signing key,
 * unreadable vault, unconstructible provider kind, a pinned policy the land
 * loop cannot honour (W12-18) — and this wave has now consolidated three
 * separate copies of an adapter dispatch that existed because someone
 * reimplemented rather than imported. Its `RunCliIO` is shimmed onto arrays so
 * those refusals become part of the run record instead of vanishing into a
 * stderr nobody is watching.
 */
interface BuildRunOutcome {
  readonly runId: string;
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

const buildRuns = new Map<string, BuildRunOutcome | 'running'>();

/** Exposed so the status route and its tests read the same map rather than a second one. */
export function buildRunStatus(runId: string): BuildRunOutcome | 'running' | undefined {
  return buildRuns.get(runId);
}

export async function executeBuildRunJob(args: {
  readonly projectPath: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly runId: string;
  readonly now: () => string;
}): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  buildRuns.set(args.runId, 'running');
  let exitCode = 1;
  try {
    const log = openEventLog(stateDbPath(args.projectPath));
    try {
      exitCode = await executeBuildRun(
        log,
        { projectId: args.projectId, actorId: args.actorId },
        args.runId,
        {
          cwd: args.projectPath,
          stdout: (line) => stdout.push(line),
          stderr: (line) => stderr.push(line),
          now: args.now,
        },
      );
    } finally {
      log.close();
    }
  } catch (err) {
    // A crash still writes a terminal record: a run stuck at `running` behind a
    // dead job is exactly the opacity W10-58 removed from the creation path.
    stderr.push(err instanceof Error ? err.message : String(err));
  } finally {
    buildRuns.set(args.runId, { runId: args.runId, exitCode, stdout, stderr });
  }
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
      if (!process.env.DOKIMA_SIGNING_KEY) {
        return reply
          .code(409)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            conflict(
              request,
              'DOKIMA_SIGNING_KEY is unset in the core process, so the close gate ' +
                'cannot mint the signed receipt that ends a run. Nothing was claimed. ' +
                'Set it in the environment the core is started from and restart it — ' +
                'there is no surface to set it from here yet (W12-43).',
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
