/**
 * The approval surface (W23-14, AB-14).
 *
 * `recordApprovedBuild` has existed since W23-02 and had no entrance a person
 * could reach: the approval could only be written by a test. So the product
 * shipped a policy that nobody could opt into, which is the same shape as a
 * check nobody runs — it exists, it is correct, and it does nothing.
 *
 * THE PREVIEW IS THE APPROVAL. A button that says "approve" over an unstated
 * specification is a click, not a decision, so the preview names what the
 * digest actually covers: the tickets, their scopes, the models that will make
 * and review the work, the budget, and the things that will still stop and ask
 * however this is set (C-5). If a person cannot see those, they cannot have
 * approved them.
 *
 * AND IT SAYS WHEN IT CANNOT PROMISE WHAT IT IS ABOUT TO OFFER (step 6). With
 * one model configured, maker and reviewer are the same model, C-4 refuses the
 * machine review, and no ticket can be accepted without a person. Advertising
 * an unattended finish in that configuration would be the silent-degradation
 * failure FR-G5 exists to prevent.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openEventLog, createIdentity } from '@dokima/events';
import { listTickets } from '@dokima/tickets';
import { ROLE_CODING_AGENT, ROLE_CODE_REVIEWER } from '@dokima/gateway';
import { resolveModelTarget } from '../pipeline/model-resolution.js';
import { recordApprovedBuild, approvedBuildDigest } from '../../cli/approved-build.js';
import { approvedBuildRunInputs } from '../../cli/approved-build.js';
import { stateDbPath } from './board-project.js';
import { listBuildRuns, summarizeBuildRun } from './approved-build-summary.js';
import { NEVER_AUTO_LIST } from './settings-types.js';
import { badRequest, resolveProjectOrProblem } from './settings-route-helpers.js';

export interface ApprovedBuildRoutesOptions {
  home?: string;
}

async function modelFor(
  projectPath: string,
  role: string,
  actorId: string,
): Promise<string | null> {
  try {
    const target = await resolveModelTarget({
      projectPath,
      role,
      taskType: role === ROLE_CODE_REVIEWER ? 'verification' : 'code',
      actorId,
    });
    return target.model;
  } catch {
    // A role with no resolvable model is a fact to SHOW, not an error to
    // throw: it is the single most likely reason the answer below is "this
    // cannot finish without you".
    return null;
  }
}

export function registerApprovedBuildRoutes(
  app: FastifyInstance,
  opts: ApprovedBuildRoutesOptions = {},
): void {
  /**
   * What this approval covers. Everything here is read from the project, never
   * from the request: a preview a caller can shape is not a specification.
   */
  app.get(
    '/api/v1/projects/:id/approved-build/preview',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const query = request.query as { actor_id?: string; budget_usd?: string };
      const actorId = query.actor_id ?? 'operator';
      const budgetUsd = query.budget_usd ? Number(query.budget_usd) : 0;

      const log = openEventLog(stateDbPath(projectPath));
      let tickets;
      let digest: string;
      try {
        tickets = listTickets(log)
          .filter((t) => t.status === 'ready' || t.status === 'blocked')
          .map((t) => ({
            id: t.id,
            title: t.title,
            lane: t.lane,
            write_scope: t.writeScope,
            acceptance: t.acceptance.map((a) => a.text),
          }));
        digest = approvedBuildDigest(
          log,
          approvedBuildRunInputs({ projectId: id, budgetUsd }),
        );
      } finally {
        log.close();
      }

      const [makerModel, reviewerModel] = await Promise.all([
        modelFor(projectPath, ROLE_CODING_AGENT, actorId),
        modelFor(projectPath, ROLE_CODE_REVIEWER, actorId),
      ]);
      const independentReview =
        makerModel !== null && reviewerModel !== null && makerModel !== reviewerModel;

      return reply.send({
        project_id: id,
        input_digest: digest,
        budget_usd: budgetUsd,
        tickets,
        maker_model: makerModel,
        reviewer_model: reviewerModel,
        independent_review: independentReview,
        /**
         * Said before launch, not discovered afterwards. One model means the
         * reviewer would be the maker's own model, C-4 refuses the machine
         * review, and every ticket needs you (Law 9b, FR-G5).
         */
        independent_review_reason: independentReview
          ? null
          : makerModel === null
            ? 'no model is configured for the coding-agent role, so nothing can build yet'
            : reviewerModel === null
              ? 'no model is configured for the code-reviewer role, so nothing independent can check the work'
              : `the reviewer would be ${reviewerModel}, the same model doing the work — a maker never reviews its own work, so every ticket will need your decision`,
        still_asks_you: NEVER_AUTO_LIST,
      });
    },
  );

  /** Records the approval. The digest is recomputed here; the body only asks. */
  app.post(
    '/api/v1/projects/:id/approved-build',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = (request.body ?? {}) as { actor_id?: string; budget_usd?: number };
      const actorId = body.actor_id ?? 'operator';
      if (body.budget_usd !== undefined && typeof body.budget_usd !== 'number') {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(badRequest(request, '"budget_usd" must be a number'));
      }
      const log = openEventLog(stateDbPath(projectPath));
      try {
        try {
          createIdentity(log, { id: actorId, name: actorId, kind: 'human' });
        } catch {
          // Already exists — the ordinary case.
        }
        const recorded = recordApprovedBuild(log, {
          actorId,
          ...approvedBuildRunInputs({ projectId: id, budgetUsd: body.budget_usd ?? 0 }),
        });
        return reply.code(201).send({
          approval_id: recorded.approvalId,
          input_digest: recorded.inputDigest,
          version: 'approved-build-v1',
        });
      } finally {
        log.close();
      }
    },
  );

  /**
   * The run's progress, from durable state. This is what a reload reads: the
   * board's poll holds nothing after a refresh, and before this card there was
   * nothing else to ask.
   */
  app.get(
    '/api/v1/projects/:id/build-runs/:runId/progress',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, runId } = request.params as { id: string; runId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const log = openEventLog(stateDbPath(projectPath));
      try {
        const summary = summarizeBuildRun(log, runId);
        if (!summary || summary.projectId !== id) {
          return reply
            .code(404)
            .type('application/problem+json')
            .send(badRequest(request, `no build run ${runId} in this project`));
        }
        return reply.send(summary);
      } finally {
        log.close();
      }
    },
  );

  /** Which runs this project has, newest first — so a reload can find the live one. */
  app.get(
    '/api/v1/projects/:id/build-runs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const log = openEventLog(stateDbPath(projectPath));
      try {
        const runs = listBuildRuns(log, id)
          .map((runId) => summarizeBuildRun(log, runId))
          .filter((s): s is NonNullable<typeof s> => s !== undefined);
        return reply.send({ runs });
      } finally {
        log.close();
      }
    },
  );
}
