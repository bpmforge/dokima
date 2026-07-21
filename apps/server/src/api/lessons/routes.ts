/**
 * Field-report intake + triage routes (BLUEPRINT §12.6, UX_SPEC §7 G-10c,
 * W7-05 conductor gate-fix). Registers `@shipwright/memory`'s
 * `packages/memory/src/lessons/**` functions as the real REST surface the
 * web `apps/web/src/lessons/**` client (`api.ts`) already targets — that
 * client was written ahead of these routes and proven only against a
 * mocked `fetchImpl`; this file is what makes it real.
 *
 * v1 is single-user (API_DESIGN §1, `board-actor.ts`): `filedBy`/`triagedBy`
 * are always resolved server-side to `OPERATOR_ACTOR_ID`, never taken from
 * the request body — the web client's draft/decision payloads carry no
 * actor field at all, by design (Law 4: identity is a trust-boundary
 * concern, never client-supplied). This means a report filed through this
 * API (by the operator) can only ever be triaged by a *different* filer —
 * same SELF_ACCEPT precedent as D-020/`packages/tickets`'s ticket accept:
 * the refusal is intentional for a human confirming their own
 * manually-filed report, not a bug; the common case is a report filed
 * under some other actor id (an agent/CLI actor, `board-actor.ts`'s
 * documented "own `--actor`" path) and triaged here by the operator.
 *
 * A `decision: 'ticket'` triage actually creates the real ticket via
 * `@shipwright/tickets`'s `createTicket` — `packages/memory` only prepares
 * the payload (Law 6: it cannot depend on `@shipwright/tickets`), this
 * route performs the real creation, same prepare-there/create-here split
 * `plans-store.ts` already uses.
 */
import { appendEvent, openEventLog, type EventLog } from '@shipwright/events';
import {
  FieldReportAlreadyTriagedError,
  FieldReportNotFoundError,
  IncompleteFieldReportError,
  SelfTriageError,
  fileFieldReport,
  listFieldReports,
  prepareValidatorFixTicket,
  rejectFieldReport,
  triageToPlaybookEntry,
  type FieldReportSource,
  type FieldReportStatus,
  type LessonsEvent,
  type LessonsEventSink,
} from '@shipwright/memory';
import {
  createTicket,
  getTicket,
  type AcceptanceCriterion,
  type CreateTicketInput,
} from '@shipwright/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { PROBLEM_CONTENT_TYPE } from '../problem.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../server/board-actor.js';
import { resolveProjectRecord, stateDbPath } from '../server/board-project.js';
import { badRequest, conflictProblem, notFoundProblem } from './shared.js';

export interface LessonsRoutesOptions {
  /** Fleet registry home dir override — tests only. */
  home?: string;
}

const now = (): string => new Date().toISOString();

const VALID_SOURCES: readonly FieldReportSource[] = ['trace', 'escalation', 'manual'];
const VALID_STATUSES: readonly FieldReportStatus[] = [
  'pending',
  'accepted_playbook',
  'accepted_ticket',
  'rejected',
];

/** Bridges `packages/memory`'s injectable `LessonsEventSink` to the real hash-chained log (Law 6/7: memory can't depend on `@shipwright/events`, so `apps/server` supplies the concrete sink). */
function eventSinkFor(log: EventLog): LessonsEventSink {
  return {
    emit(event: LessonsEvent) {
      appendEvent(log, { eventType: event.type, actorId: event.actorId, payload: event });
    },
  };
}

interface FileReportBody {
  ticketId?: unknown;
  source?: unknown;
  sourceRef?: unknown;
  whatHappened?: unknown;
  expected?: unknown;
  evidenceLinks?: unknown;
}

type TriageBody =
  | { decision?: 'playbook'; taskClass?: unknown; entry?: unknown; triageNote?: unknown }
  | {
      decision?: 'ticket';
      ticketId?: unknown;
      title?: unknown;
      lane?: unknown;
      writeScope?: unknown;
      acceptance?: unknown;
      verify?: unknown;
      triageNote?: unknown;
    }
  | { decision?: 'reject'; triageNote?: unknown };

export function registerLessonsRoutes(
  app: FastifyInstance,
  opts: LessonsRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  async function projectOr404(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
  ) {
    const record = await resolveProjectRecord(registryPath, projectId);
    if (!record) {
      await reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send(notFoundProblem(request, `no project registered with id ${projectId}`));
      return undefined;
    }
    return record;
  }

  /** `POST /api/v1/projects/:id/field-reports` — files a report; `filedBy` is always the resolved operator identity, never client-supplied. */
  app.post(
    '/api/v1/projects/:id/field-reports',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const body = (request.body ?? {}) as FileReportBody;
      const source =
        typeof body.source === 'string' &&
        VALID_SOURCES.includes(body.source as FieldReportSource)
          ? (body.source as FieldReportSource)
          : undefined;
      if (!source) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"source" must be one of trace, escalation, manual'));
      }

      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        const created = fileFieldReport(
          log.db,
          {
            ticketId: typeof body.ticketId === 'string' ? body.ticketId : null,
            source,
            sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : null,
            whatHappened: typeof body.whatHappened === 'string' ? body.whatHappened : '',
            expected: typeof body.expected === 'string' ? body.expected : '',
            evidenceLinks: Array.isArray(body.evidenceLinks)
              ? body.evidenceLinks.filter((l): l is string => typeof l === 'string')
              : [],
            filedBy: OPERATOR_ACTOR_ID,
          },
          now,
          { sink: eventSinkFor(log) },
        );
        return reply.code(201).send(created);
      } catch (err) {
        if (err instanceof IncompleteFieldReportError) {
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

  /** `GET /api/v1/projects/:id/field-reports?status=` — the triage queue's read path. */
  app.get(
    '/api/v1/projects/:id/field-reports',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const query = request.query as { status?: string };
      const status =
        typeof query.status === 'string' &&
        VALID_STATUSES.includes(query.status as FieldReportStatus)
          ? (query.status as FieldReportStatus)
          : undefined;

      const log = openEventLog(stateDbPath(record.path));
      try {
        const items = listFieldReports(log.db, { status });
        return reply.send({ items });
      } finally {
        log.close();
      }
    },
  );

  /** `POST /api/v1/field-reports/:id/triage?project=` — accept-to-playbook, accept-to-ticket, or reject. Refuses self-triage (Law 5, `SelfTriageError`). */
  app.post(
    '/api/v1/field-reports/:id/triage',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const reportId = Number((request.params as { id: string }).id);
      if (!Number.isInteger(reportId)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'field report id must be an integer'));
      }
      const projectId = (request.query as Record<string, unknown>).project;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required "project" query parameter'));
      }
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const body = (request.body ?? {}) as TriageBody;
      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        const sink = eventSinkFor(log);
        const triagedBy = OPERATOR_ACTOR_ID;

        if (body.decision === 'playbook') {
          if (typeof body.taskClass !== 'string' || typeof body.entry !== 'string') {
            return reply
              .code(400)
              .type(PROBLEM_CONTENT_TYPE)
              .send(
                badRequest(request, '"taskClass" and "entry" (strings) are required'),
              );
          }
          const result = triageToPlaybookEntry(
            log.db,
            {
              reportId,
              triagedBy,
              taskClass: body.taskClass,
              entry: body.entry,
              triageNote:
                typeof body.triageNote === 'string' ? body.triageNote : undefined,
            },
            now,
            { sink },
          );
          return reply.send(result.report);
        }

        if (body.decision === 'ticket') {
          if (
            typeof body.ticketId !== 'string' ||
            typeof body.title !== 'string' ||
            typeof body.lane !== 'string' ||
            !Array.isArray(body.writeScope) ||
            body.writeScope.length === 0
          ) {
            return reply
              .code(400)
              .type(PROBLEM_CONTENT_TYPE)
              .send(
                badRequest(
                  request,
                  '"ticketId", "title", "lane" (strings) and a non-empty "writeScope" array are required',
                ),
              );
          }
          /**
           * Checked before `prepareValidatorFixTicket` runs, not after:
           * that call already UPDATEs the report to `accepted_ticket` and
           * emits `lessons.triaged` with no enclosing transaction (Law 6 —
           * `packages/memory` can't depend on `@shipwright/events`, so it
           * has no transaction to share with `createTicket`'s). Checking
           * `createTicket`'s own "already exists" error afterward would
           * leave the report permanently triaged with a `resultingTicketId`
           * pointing at a ticket that was never created — un-retriable
           * (no longer `pending`) and a triaged event for a ticket that
           * doesn't exist. Single-writer-per-DB (Law 7) makes this
           * check-then-act safe: nothing else can create `body.ticketId`
           * between this check and `createTicket` below.
           */
          if (getTicket(log, body.ticketId)) {
            return reply
              .code(409)
              .type(PROBLEM_CONTENT_TYPE)
              .send(conflictProblem(request, `ticket ${body.ticketId} already exists`));
          }

          const { payload } = prepareValidatorFixTicket(
            log.db,
            {
              reportId,
              triagedBy,
              ticketId: body.ticketId,
              title: body.title,
              lane: body.lane,
              writeScope: body.writeScope.filter(
                (s): s is string => typeof s === 'string',
              ),
              acceptance: Array.isArray(body.acceptance)
                ? body.acceptance.filter((a): a is string => typeof a === 'string')
                : undefined,
              verify: typeof body.verify === 'string' ? body.verify : undefined,
              triageNote:
                typeof body.triageNote === 'string' ? body.triageNote : undefined,
            },
            now,
            { sink },
          );

          const acceptance: AcceptanceCriterion[] = payload.acceptance.map((text, i) => ({
            id: `AC-${i + 1}`,
            text,
            done: false,
          }));
          const ticketInput: CreateTicketInput = {
            id: payload.id,
            type: payload.type,
            title: payload.title,
            lane: payload.lane,
            writeScope: payload.writeScope,
            dependsOn: payload.dependsOn,
            acceptance,
            verify: payload.verify,
          };
          createTicket(log, OPERATOR_ACTOR_ID, ticketInput, { now });

          const updated = listFieldReports(log.db, {}).find((r) => r.id === reportId);
          return reply.send(updated);
        }

        if (body.decision === 'reject') {
          const rejected = rejectFieldReport(
            log.db,
            {
              reportId,
              triagedBy,
              triageNote:
                typeof body.triageNote === 'string' ? body.triageNote : undefined,
            },
            now,
            { sink },
          );
          return reply.send(rejected);
        }

        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(request, '"decision" must be one of playbook, ticket, reject'),
          );
      } catch (err) {
        if (err instanceof FieldReportNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFoundProblem(request, err.message));
        }
        if (err instanceof SelfTriageError) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(conflictProblem(request, err.message, 'SELF_TRIAGE'));
        }
        if (err instanceof FieldReportAlreadyTriagedError) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(conflictProblem(request, err.message, 'ALREADY_TRIAGED'));
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );
}
