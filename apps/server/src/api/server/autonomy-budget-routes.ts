/**
 * `GET/PUT /projects/{id}/autonomy` (API_DESIGN §136) and
 * `GET/PUT /projects/{id}/budget` (API_DESIGN §95) — typed convenience
 * routes over the `autonomy` / `budget` keys in project-scope settings.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JsonValue } from '@dokima/shared';
import { badRequest, resolveProjectOrProblem } from './settings-route-helpers.js';
import { getProjectSettings, putProjectSetting } from './settings-scope.js';
import {
  BREAKER_THRESHOLDS,
  NEVER_AUTO_LIST,
  type AutonomyMode,
} from './settings-types.js';

function isAutonomyMode(value: unknown): value is AutonomyMode {
  return value === 'interactive' || value === 'auto';
}

/** Stored (and read back) wire-shaped — snake_case, no camelCase translation layer needed for a value only these two handlers ever touch. */
interface StoredBudget {
  run_limit_usd?: number;
  project_limit_usd?: number;
}

function readStoredBudget(value: JsonValue | undefined): StoredBudget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const v = value as Record<string, JsonValue>;
  return {
    ...(typeof v.run_limit_usd === 'number' ? { run_limit_usd: v.run_limit_usd } : {}),
    ...(typeof v.project_limit_usd === 'number'
      ? { project_limit_usd: v.project_limit_usd }
      : {}),
  };
}

export interface AutonomyBudgetRoutesOptions {
  home?: string;
}

export function registerAutonomyBudgetRoutes(
  app: FastifyInstance,
  opts: AutonomyBudgetRoutesOptions = {},
): void {
  app.get(
    '/api/v1/projects/:id/autonomy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const settings = await getProjectSettings(projectPath);
      const mode: AutonomyMode = settings.autonomy === 'auto' ? 'auto' : 'interactive';
      return reply.send({ mode, never_auto: NEVER_AUTO_LIST });
    },
  );

  app.put(
    '/api/v1/projects/:id/autonomy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      if (!isAutonomyMode(body?.mode)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(badRequest(request, '"mode" must be "interactive" or "auto"'));
      }
      await putProjectSetting(projectPath, 'autonomy', body.mode);
      return reply.send({ mode: body.mode, never_auto: NEVER_AUTO_LIST });
    },
  );

  app.get(
    '/api/v1/projects/:id/budget',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const settings = await getProjectSettings(projectPath);
      const limits = readStoredBudget(settings.budget);
      return reply.send({
        run_limit_usd: limits.run_limit_usd ?? null,
        project_limit_usd: limits.project_limit_usd ?? null,
        breaker_thresholds: {
          warn: BREAKER_THRESHOLDS.warn,
          downshift: BREAKER_THRESHOLDS.downshift,
          hard_stop: BREAKER_THRESHOLDS.hardStop,
        },
      });
    },
  );

  app.put(
    '/api/v1/projects/:id/budget',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      const runLimit = body?.run_limit_usd;
      const projectLimit = body?.project_limit_usd;
      if (
        (runLimit !== undefined && typeof runLimit !== 'number') ||
        (projectLimit !== undefined && typeof projectLimit !== 'number')
      ) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(request, '"run_limit_usd"/"project_limit_usd" must be numbers'),
          );
      }
      const limits: StoredBudget = {
        ...(runLimit !== undefined ? { run_limit_usd: runLimit as number } : {}),
        ...(projectLimit !== undefined
          ? { project_limit_usd: projectLimit as number }
          : {}),
      };
      await putProjectSetting(projectPath, 'budget', limits as unknown as JsonValue);
      return reply.send({
        run_limit_usd: limits.run_limit_usd ?? null,
        project_limit_usd: limits.project_limit_usd ?? null,
        breaker_thresholds: {
          warn: BREAKER_THRESHOLDS.warn,
          downshift: BREAKER_THRESHOLDS.downshift,
          hard_stop: BREAKER_THRESHOLDS.hardStop,
        },
      });
    },
  );
}
