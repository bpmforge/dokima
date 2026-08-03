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
import type { JsonValue, SettingsMap } from '@dokima/shared';
import { PRESET_NAMES } from '@dokima/gateway';
import {
  badRequest,
  forbidden,
  resolveProjectOrProblem,
} from './settings-route-helpers.js';
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

/**
 * D-019 consent gate + any NEVER-AUTO-adjacent flag: these keys only ever
 * flip through their dedicated consent/confirmation endpoint (Copilot's
 * `POST/DELETE /projects/{id}/copilot-consent`, which mints the ledgered
 * `copilot.consent_ack` event per FR-G6). The generic key/value settings
 * PUT below is a flat pass-through with no per-key validation otherwise, so
 * without this blocklist a caller could `PUT {"copilotEnabled": true}`
 * straight through it and silently bypass the consent gate — no risk
 * warning shown, no ack event minted. Reject the whole request (never
 * silently drop just the gated key) so the caller sees the bypass attempt
 * fail loudly.
 */
const CONSENT_GATED_KEYS = new Set(['copilotEnabled']);

function findConsentGatedKey(body: Record<string, JsonValue>): string | undefined {
  return Object.keys(body).find((key) => CONSENT_GATED_KEYS.has(key));
}

/** Sends the 403 refusal and returns true if `body` names a consent-gated key — call before any write, on both the global and project generic PUTs. */
function refuseConsentGatedKey(
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
): boolean {
  if (!isPlainSettingsBody(body)) return false;
  const gatedKey = findConsentGatedKey(body);
  if (!gatedKey) return false;
  reply
    .code(403)
    .type('application/problem+json')
    .send(
      forbidden(
        request,
        `"${gatedKey}" is consent-gated (D-019) and cannot be set via the generic settings PUT — use its dedicated consent endpoint instead`,
        'consent-gated-key',
      ),
    );
  return true;
}

/**
 * `defaultModelMatrixPreset`'s only legal values are `@dokima/gateway`'s
 * shipped preset names (FR-S3, W10-42 AC5). `PUT /api/v1/settings/global`
 * (FirstRunWizard's `savePresetAndProvider`) is the only caller that writes
 * this key today, but the generic settings PUT otherwise passes any value
 * straight through with no per-key validation at *either* scope — and
 * `getEffectiveProjectSettings` resolves run > project > global, so an
 * unvalidated project-scope write would win over a validated global one.
 * Checked on both PUTs for the same reason `refuseConsentGatedKey` is
 * (defense in depth, not just the one call site in active use).
 */
function findInvalidPreset(body: Record<string, JsonValue>): JsonValue | undefined {
  if (!('defaultModelMatrixPreset' in body)) return undefined;
  const value = body.defaultModelMatrixPreset;
  return typeof value === 'string' && (PRESET_NAMES as readonly string[]).includes(value)
    ? undefined
    : value;
}

/** Sends the 400 refusal and returns true if `body` names an unrecognized `defaultModelMatrixPreset` — malformed input, not a consent denial, hence 400 not 403. */
function refuseUnknownPreset(
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
): boolean {
  if (!isPlainSettingsBody(body)) return false;
  const invalid = findInvalidPreset(body);
  if (invalid === undefined) return false;
  reply
    .code(400)
    .type('application/problem+json')
    .send(
      badRequest(
        request,
        `"defaultModelMatrixPreset" must be one of ${PRESET_NAMES.join(', ')}, got ${JSON.stringify(invalid)}`,
        'unknown-preset',
      ),
    );
  return true;
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
      if (refuseConsentGatedKey(request, reply, request.body)) return;
      if (refuseUnknownPreset(request, reply, request.body)) return;
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
      if (refuseConsentGatedKey(request, reply, request.body)) return;
      if (refuseUnknownPreset(request, reply, request.body)) return;
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
