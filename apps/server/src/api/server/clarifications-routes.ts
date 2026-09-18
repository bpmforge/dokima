/**
 * Clarification routes — FR-N1's verbs, reached at last (W23-28).
 *
 * `askClarification` / `answerClarification` / `dismissClarification` /
 * `listOpenClarifications` were built, tested and exported under FR-N1
 * (US-701, UC-03) and adopted by nothing; W23-25 marked them against this
 * ticket rather than delete a requirement. They are wired HERE, beside the
 * notifications routes, because the product already has one morning queue
 * with a `clarification` kind at leverage 20 (FR-H4) and a second surface
 * would be the drift the marker warned about: an open clarification is a
 * Decide-tier card, and answering or dismissing it resolves that card.
 *
 * Dismissal takes the documented default and leaves the autonomy-ledger row
 * naming who dismissed it — the verb does that itself (`appendAutoDefaultRow`
 * with the actor), which is why `getReceiptActor` was deleted with its marker
 * rather than wired: nothing here needs to read an actor back off a receipt.
 */
import { randomUUID } from 'node:crypto';
import { openEventLog, type EventLog } from '@dokima/events';
import {
  answerClarification,
  askClarification,
  ClarificationNotFoundError,
  ClarificationNotOpenError,
  dismissClarification,
  listOpenClarifications,
  type ClarificationRecord,
} from '@dokima/harbormaster';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ensureActorIdentity } from '../../cli/identity.js';
import { getProjectSettings } from './settings-scope.js';
import {
  decideNotification,
  dismissNotification,
  emitNotification,
  listNotifications,
} from '../notifications/index.js';
import { LEVERAGE_BY_KIND } from '../notifications/types.js';
import { PROBLEM_CONTENT_TYPE } from '../problem.js';
import { computeFleetRegistryPath } from '../projects.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from './board-actor.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';
import { badRequest, notFoundProblem } from './notifications-routes/shared.js';

export interface ClarificationRoutesOptions {
  home?: string;
}

export const CLARIFICATION_REF_TYPE = 'clarification';

function toWire(record: ClarificationRecord) {
  return {
    id: record.id,
    run_id: record.runId,
    ticket_id: record.ticketId,
    asked_by: record.askedBy,
    question: record.question,
    context: record.context,
    options: record.options,
    default_action: record.defaultAction,
    status: record.status,
    answer: record.answer,
  };
}

/** The Decide card that carries this clarification in the morning queue, if it is still open. */
function openCardFor(log: EventLog, clarificationId: string) {
  return listNotifications(log, { status: 'open' }).find(
    (n) => n.refType === CLARIFICATION_REF_TYPE && n.refId === clarificationId,
  );
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

export function registerClarificationRoutes(
  app: FastifyInstance,
  opts: ClarificationRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  async function projectLogOr404(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
  ): Promise<(EventLog & { projectPath: string }) | undefined> {
    const record = await resolveProjectRecord(registryPath, projectId);
    if (!record) {
      await reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send(notFoundProblem(request, `no project registered with id ${projectId}`));
      return undefined;
    }
    return Object.assign(openEventLog(stateDbPath(record.path)), {
      projectPath: record.path,
    });
  }

  app.get(
    '/api/v1/projects/:id/clarifications',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const runId = (request.query as Record<string, unknown>).run;
      const log = await projectLogOr404(request, reply, id);
      if (!log) return reply;
      try {
        const items = listOpenClarifications(log, nonEmpty(runId) ? runId : undefined);
        return reply.send({ items: items.map(toWire) });
      } finally {
        log.close();
      }
    },
  );

  app.post(
    '/api/v1/projects/:id/clarifications',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      for (const field of ['runId', 'question', 'defaultAction', 'checkpointRef']) {
        if (!nonEmpty(body[field])) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              badRequest(
                request,
                `body.${field} is required and must be a non-empty string`,
              ),
            );
        }
      }
      const log = await projectLogOr404(request, reply, id);
      if (!log) return reply;
      try {
        ensureOperatorIdentity(log);
        const askedBy = nonEmpty(body.askedBy) ? body.askedBy : OPERATOR_ACTOR_ID;
        if (askedBy !== OPERATOR_ACTOR_ID) ensureActorIdentity(log, askedBy);
        // W13-32 / D-033: the project's autonomy dial, injected here because
        // harbormaster cannot read settings. In auto, a safe-listed default
        // is taken in the verb itself; the card is then already resolved.
        const settings = await getProjectSettings(log.projectPath);
        const mode = settings.autonomy === 'auto' ? 'auto' : 'interactive';
        const record = askClarification(
          log,
          {
            id: `clarification-${randomUUID()}`,
            runId: body.runId as string,
            ticketId: nonEmpty(body.ticketId) ? body.ticketId : null,
            askedBy,
            question: body.question as string,
            context: body.context,
            options: body.options,
            defaultAction: body.defaultAction as string,
            checkpointRef: body.checkpointRef as string,
          },
          { autonomy: { mode } },
        );
        if (record.status === 'dismissed') {
          // Auto took the documented default: ledgered, nothing for the queue.
          return reply.code(201).send({ ...toWire(record), auto_defaulted: true });
        }
        // ONE queue (FR-H4): the clarification is a Decide card at leverage 20,
        // exactly the kind decide-slates.ts already mints for founder slates.
        emitNotification(log, {
          id: `clarification-card-${randomUUID()}`,
          tier: 'decide',
          kind: 'clarification',
          refType: CLARIFICATION_REF_TYPE,
          refId: record.id,
          title:
            record.question.length > 120
              ? `${record.question.slice(0, 117)}...`
              : record.question,
          body: {
            clarificationId: record.id,
            runId: record.runId,
            ticketId: record.ticketId,
            options: record.options,
            defaultAction: record.defaultAction,
            message:
              'A question is holding work that depends on the answer; everything else continues.',
          },
          leverage: LEVERAGE_BY_KIND.clarification,
          actorId: askedBy,
        });
        return reply.code(201).send(toWire(record));
      } catch (err) {
        // The verb's own FK refusals (an unknown run) surface as a plain 400 with the message.
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, err instanceof Error ? err.message : String(err)));
      } finally {
        log.close();
      }
    },
  );

  const resolveRoute =
    (verb: 'answer' | 'dismiss') =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, cid } = request.params as { id: string; cid: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (verb === 'answer' && !nonEmpty(body.answer)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(request, 'body.answer is required and must be a non-empty string'),
          );
      }
      const log = await projectLogOr404(request, reply, id);
      if (!log) return reply;
      try {
        ensureOperatorIdentity(log);
        const record =
          verb === 'answer'
            ? answerClarification(log, {
                id: cid,
                answer: body.answer as string,
                actorId: OPERATOR_ACTOR_ID,
              })
            : dismissClarification(log, {
                id: cid,
                actorId: OPERATOR_ACTOR_ID,
                ledgerRowId: `clarification-default-${randomUUID()}`,
              });
        // Resolve the card the same way, so the queue never demands an answer
        // that already exists (the decide-slates rule, applied here).
        const card = openCardFor(log, cid);
        if (card) {
          if (verb === 'answer') {
            decideNotification(log, card.id, 'approved', {
              actorId: OPERATOR_ACTOR_ID,
              note: record.answer ?? undefined,
            });
          } else {
            dismissNotification(log, card.id, { actorId: OPERATOR_ACTOR_ID });
          }
        }
        return reply.send(toWire(record));
      } catch (err) {
        if (err instanceof ClarificationNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFoundProblem(request, err.message));
        }
        if (err instanceof ClarificationNotOpenError) {
          return reply.code(409).type(PROBLEM_CONTENT_TYPE).send({
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: err.message,
            instance: request.url,
          });
        }
        throw err;
      } finally {
        log.close();
      }
    };
  app.post('/api/v1/projects/:id/clarifications/:cid/answer', resolveRoute('answer'));
  app.post('/api/v1/projects/:id/clarifications/:cid/dismiss', resolveRoute('dismiss'));
}
