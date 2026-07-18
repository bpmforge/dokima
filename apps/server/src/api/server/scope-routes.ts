/**
 * Generic three-scope settings endpoints (API_DESIGN §105-114, FR-S1..S3):
 * `GET/PUT /settings/global`, `GET/PUT /projects/{id}/settings`,
 * `GET /projects/{id}/settings/effective`. Every other typed panel (matrix,
 * autonomy, budget, berths, MCP, validator packs, expert overrides,
 * escalation policy, Copilot) reads/writes named keys through these same
 * two scopes — this file is the generic key/value surface; the typed
 * routes in autonomy-budget-routes.ts/rules-routes.ts/consent-routes.ts
 * layer validation and defaults on top of specific keys.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JsonValue, SettingsMap } from '@shipwright/shared';
import { badRequest, resolveProjectOrProblem } from './settings-route-helpers.js';
import {
  getEffectiveProjectSettings,
  getGlobalSettings,
  getProjectSettings,
  putGlobalSetting,
  putProjectSetting,
} from './settings-scope.js';

function isPlainSettingsBody(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function applyEachKey(
  body: unknown,
  write: (key: string, value: JsonValue | undefined) => Promise<SettingsMap>,
): Promise<SettingsMap | undefined> {
  if (!isPlainSettingsBody(body)) return undefined;
  let latest: SettingsMap = {};
  for (const [key, value] of Object.entries(body)) {
    latest = await write(key, value);
  }
  return latest;
}

export interface ScopeRoutesOptions {
  home?: string;
}

export function registerScopeRoutes(
  app: FastifyInstance,
  opts: ScopeRoutesOptions = {},
): void {
  app.get(
    '/api/v1/settings/global',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send(await getGlobalSettings());
    },
  );

  app.put(
    '/api/v1/settings/global',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown>;
      const loggingProjectPath =
        typeof query.project === 'string'
          ? await resolveProjectOrProblem(request, reply, query.project, opts.home)
          : undefined;
      if (typeof query.project === 'string' && !loggingProjectPath) return;
      const next = await applyEachKey(request.body, (key, value) =>
        putGlobalSetting(key, value, loggingProjectPath),
      );
      if (!next) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(
              request,
              'body must be a flat JSON object of settings key/value pairs',
            ),
          );
      }
      return reply.send(next);
    },
  );

  app.get(
    '/api/v1/projects/:id/settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      return reply.send(await getProjectSettings(projectPath));
    },
  );

  app.put(
    '/api/v1/projects/:id/settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const next = await applyEachKey(request.body, (key, value) =>
        putProjectSetting(projectPath, key, value),
      );
      if (!next) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(
              request,
              'body must be a flat JSON object of settings key/value pairs',
            ),
          );
      }
      return reply.send(next);
    },
  );

  app.get(
    '/api/v1/projects/:id/settings/effective',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const query = request.query as Record<string, unknown>;
      const run =
        typeof query.run === 'string'
          ? (JSON.parse(query.run) as SettingsMap)
          : undefined;
      const effective = await getEffectiveProjectSettings(projectPath, run);
      const wire: Record<
        string,
        { value: JsonValue; winning_scope: string; overridden: unknown[] }
      > = {};
      for (const [key, entry] of Object.entries(effective)) {
        wire[key] = {
          value: entry.value,
          winning_scope: entry.winningScope,
          overridden: entry.overridden.map((o) => ({ scope: o.scope, value: o.value })),
        };
      }
      return reply.send(wire);
    },
  );
}
