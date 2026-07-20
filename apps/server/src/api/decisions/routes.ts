/**
 * Decision slate routes (API_DESIGN.md "decisions & slates", FR-P6):
 *   POST /api/v1/projects/:id/slates        — create (not in API_DESIGN's
 *     documented catalog, same precedent as runs-routes.ts's `GET
 *     /tickets/:id/runs`: the minimal addition the documented flow needs to
 *     be reachable at all — a slate has to be created somewhere before it
 *     can be listed or decided).
 *   GET  /api/v1/projects/:id/slates?status=open
 *   POST /api/v1/slates/:id/decide?project=  — `?project=` query param
 *     disambiguator, same shape as `board-project.ts`'s verb routes (keyed
 *     only by the resource id, per API_DESIGN's documented path).
 *   GET  /api/v1/projects/:id/decisions      — the D-ID ledger (decided only)
 *
 * NOT wired into `apps/server/src/api/server.ts`'s bootstrap: that file is
 * outside this ticket's write_scope (`apps/server/src/api/decisions/**`
 * only), same as `apps/server/src/api/pipeline/pipeline-routes/index.ts`'s
 * `registerPipelineRoutes` from W5-18, which is exported and
 * inject-tested but likewise never called from `server.ts`. Wiring
 * `registerDecisionRoutes` into the live app is a one-line follow-up
 * outside this ticket's reach.
 */
import { openEventLog } from '@shipwright/events';
import {
  InvalidFounderSlateError,
  InvalidTechnicalSlateError,
  type FounderSlateInput,
  type TechnicalSlateInput,
} from '@shipwright/pipeline';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { PROBLEM_CONTENT_TYPE } from '../problem.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../server/board-actor.js';
import { resolveProjectRecord, stateDbPath } from '../server/board-project.js';
import { badRequest, conflictProblem, notFoundProblem } from './shared.js';
import {
  createSlate,
  decideSlate,
  listDecisions,
  listSlates,
  type CreateSlateInput,
} from './store.js';
import {
  InvalidChoiceError,
  SlateAlreadyDecidedError,
  SlateNotFoundError,
  type SlateRecord,
} from './types.js';

export interface DecisionRoutesOptions {
  /** Fleet registry home dir override — tests only. */
  home?: string;
}

interface CreateSlateBody {
  kind?: unknown;
  founder?: FounderSlateInput;
  technical?: TechnicalSlateInput;
}

interface DecideBody {
  chosen?: unknown;
  rationale?: unknown;
}

function toWire(record: SlateRecord) {
  return {
    id: record.id,
    status: record.status,
    slate: record.slate,
    chosen: record.chosen,
    rationale: record.rationale,
    d_id: record.dId,
    decided_by: record.decidedBy,
    decided_at: record.decidedAt,
    created_at: record.createdAt,
  };
}

function parseCreateInput(body: CreateSlateBody): CreateSlateInput {
  if (body.kind === 'founder') {
    return { kind: 'founder', founder: (body.founder ?? {}) as FounderSlateInput };
  }
  if (body.kind === 'technical') {
    return {
      kind: 'technical',
      technical: (body.technical ?? {}) as TechnicalSlateInput,
    };
  }
  throw new InvalidFounderSlateError('body.kind must be "founder" or "technical"');
}

export function registerDecisionRoutes(
  app: FastifyInstance,
  opts: DecisionRoutesOptions = {},
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

  app.post(
    '/api/v1/projects/:id/slates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      let input: CreateSlateInput;
      try {
        input = parseCreateInput((request.body ?? {}) as CreateSlateBody);
      } catch (err) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, (err as Error).message));
      }

      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        const created = createSlate(log, input, { actorId: OPERATOR_ACTOR_ID });
        return reply.code(201).send(toWire(created));
      } catch (err) {
        if (
          err instanceof InvalidFounderSlateError ||
          err instanceof InvalidTechnicalSlateError
        ) {
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

  app.get(
    '/api/v1/projects/:id/slates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const query = request.query as { status?: string };
      const status =
        query.status === 'open' || query.status === 'decided' ? query.status : undefined;

      const log = openEventLog(stateDbPath(record.path));
      try {
        const items = listSlates(log, { status }).map(toWire);
        return reply.send({ items });
      } finally {
        log.close();
      }
    },
  );

  app.post(
    '/api/v1/slates/:id/decide',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: slateId } = request.params as { id: string };
      const projectId = (request.query as Record<string, unknown>).project;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required "project" query parameter'));
      }
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const body = (request.body ?? {}) as DecideBody;
      if (typeof body.chosen !== 'string' || body.chosen.trim() === '') {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"chosen" (non-empty string) is required'));
      }

      const log = openEventLog(stateDbPath(record.path));
      try {
        ensureOperatorIdentity(log);
        const decided = decideSlate(
          log,
          {
            slateId,
            chosen: body.chosen,
            rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
          },
          { projectPath: record.path, actorId: OPERATOR_ACTOR_ID },
        );
        return reply.send({
          id: slateId,
          d_id: decided.id,
          date: decided.date,
          decision: decided.decision,
          options_considered: decided.optionsConsidered,
          rationale: decided.rationale,
        });
      } catch (err) {
        if (err instanceof SlateNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFoundProblem(request, err.message));
        }
        if (
          err instanceof SlateAlreadyDecidedError ||
          err instanceof InvalidChoiceError
        ) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(conflictProblem(request, err.message));
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );

  app.get(
    '/api/v1/projects/:id/decisions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const log = openEventLog(stateDbPath(record.path));
      try {
        const items = listDecisions(log).map(toWire);
        return reply.send({ items });
      } finally {
        log.close();
      }
    },
  );
}
