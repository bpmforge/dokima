/**
 * Rule-lifecycle admin + suppression review (API_DESIGN §116-124, D-014,
 * FR-RL2/RL3, AC3): `GET /projects/{id}/rules`, `POST /rules/{id}/promote`
 * `/demote`, `GET /projects/{id}/suppressions`,
 * `POST /findings/{fingerprint}/suppress`.
 *
 * Rule ids are project-scoped (the `rule_state` table lives in the
 * project's own state.db), so unlike the API_DESIGN catalog's path shape
 * `/rules/{id}/promote` these routes require a `project_id` in the body —
 * documented here since the catalog was written before D-014's per-project
 * `rule_state` table existed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  badRequest,
  conflict,
  resolveProjectOrProblem,
} from './settings-route-helpers.js';
import {
  DEFAULT_PROMOTION_CRITERIA,
  demoteRule,
  listRuleStates,
  promoteRule,
  registerRule,
  RuleStateError,
} from './rule-state-store.js';
import { createSuppression, listSuppressions } from './suppression-store.js';
import {
  SUPPRESSION_JUSTIFICATIONS,
  type SuppressionJustification,
} from './settings-types.js';

function isJustification(value: unknown): value is SuppressionJustification {
  return (
    typeof value === 'string' &&
    (SUPPRESSION_JUSTIFICATIONS as readonly string[]).includes(value)
  );
}

function ruleStateStatusFor(code: RuleStateError['code']): number {
  return code === 'UNKNOWN_RULE' ? 404 : 409;
}

export interface RulesRoutesOptions {
  home?: string;
}

export function registerRulesRoutes(
  app: FastifyInstance,
  opts: RulesRoutesOptions = {},
): void {
  app.get(
    '/api/v1/projects/:id/rules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const rules = await listRuleStates(projectPath);
      return reply.send({
        rules: rules.map((r) => ({
          rule_id: r.ruleId,
          state: r.state,
          fp_window_findings: r.fpWindowFindings,
          fp_window_fps: r.fpWindowFps,
          fp_rate: r.fpRate,
          promoted_at: r.promotedAt,
          demotion_flagged: r.demotionFlagged,
          updated_at: r.updatedAt,
        })),
      });
    },
  );

  app.post(
    '/api/v1/projects/:id/rules/:ruleId/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, ruleId } = request.params as { id: string; ruleId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const row = await registerRule(projectPath, ruleId);
      return reply.code(201).send({ rule_id: row.ruleId, state: row.state });
    },
  );

  app.post(
    '/api/v1/projects/:id/rules/:ruleId/promote',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, ruleId } = request.params as { id: string; ruleId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      const minSampleCount =
        typeof body?.min_sample_count === 'number'
          ? body.min_sample_count
          : DEFAULT_PROMOTION_CRITERIA.minSampleCount;
      const maxFpRate =
        typeof body?.max_fp_rate === 'number'
          ? body.max_fp_rate
          : DEFAULT_PROMOTION_CRITERIA.maxFpRate;
      try {
        const row = await promoteRule(projectPath, ruleId, { minSampleCount, maxFpRate });
        return reply.send({ rule_id: row.ruleId, state: row.state, fp_rate: row.fpRate });
      } catch (err) {
        if (err instanceof RuleStateError) {
          return reply
            .code(ruleStateStatusFor(err.code))
            .type('application/problem+json')
            .send(conflict(request, err.message, err.code));
        }
        throw err;
      }
    },
  );

  app.post(
    '/api/v1/projects/:id/rules/:ruleId/demote',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, ruleId } = request.params as { id: string; ruleId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      try {
        const row = await demoteRule(projectPath, ruleId);
        return reply.send({ rule_id: row.ruleId, state: row.state });
      } catch (err) {
        if (err instanceof RuleStateError) {
          return reply
            .code(ruleStateStatusFor(err.code))
            .type('application/problem+json')
            .send(conflict(request, err.message, err.code));
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/v1/projects/:id/suppressions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const rows = await listSuppressions(projectPath);
      return reply.send({
        suppressions: rows.map((r) => ({
          id: r.id,
          fingerprint: r.fingerprint,
          rule_id: r.ruleId,
          justification: r.justification,
          signed_by: r.signedBy,
          context_key: r.contextKey,
          status: r.status,
          created_at: r.createdAt,
          reopened_at: r.reopenedAt,
        })),
      });
    },
  );

  app.post(
    '/api/v1/projects/:id/findings/:fingerprint/suppress',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, fingerprint } = request.params as { id: string; fingerprint: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      if (
        !isJustification(body?.justification) ||
        typeof body?.signature !== 'string' ||
        body.signature.trim() === ''
      ) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(
              request,
              `"justification" must be one of ${SUPPRESSION_JUSTIFICATIONS.join(', ')}; "signature" (human name, SC-05) is required`,
            ),
          );
      }
      const contextKey = typeof body.context_key === 'string' ? body.context_key : '';
      const ruleId = typeof body.rule_id === 'string' ? body.rule_id : null;
      const row = await createSuppression(projectPath, {
        fingerprint,
        ruleId,
        justification: body.justification,
        signedBy: body.signature,
        contextKey,
      });
      return reply.code(201).send({
        id: row.id,
        fingerprint: row.fingerprint,
        rule_id: row.ruleId,
        justification: row.justification,
        signed_by: row.signedBy,
        context_key: row.contextKey,
        status: row.status,
        created_at: row.createdAt,
      });
    },
  );
}
