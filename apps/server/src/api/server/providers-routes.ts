/**
 * GET/PUT/DELETE /api/v1/projects/{id}/providers (W10-01, FR-G1/FR-S2/D-019).
 *
 * Project-scoped rather than the flat `/api/v1/providers` the ticket sketched:
 * the registry IS the `providers` settings key, settings are three-scope and
 * project-resolved, and every sibling settings surface (model-matrix, rules,
 * consent) is addressed the same way. A global route would have implied a
 * storage location that does not exist.
 *
 * The credential refusal lives HERE, at the boundary, not in the store: a
 * literal key must be rejected before anything is written, never "stored then
 * scrubbed" (Law 8, FR-S2).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ProviderRegistryError,
  validateProviderRegistry,
  type ProviderEntry,
  type ProviderKind,
} from '@dokima/gateway';
import { looksLikeSecret } from '@dokima/shared';
import { PROBLEM_CONTENT_TYPE, problem } from '../problem.js';
import { listProviders, putProviders, removeProvider } from './providers-store.js';
import { resolveProjectOrProblem } from './settings-route-helpers.js';
import { getProjectSettings } from './settings-scope.js';

export interface ProvidersRoutesOptions {
  /** Overrides the fleet home — tests only. */
  home?: string;
}

interface WireProvider {
  id: string;
  kind: ProviderKind;
  base_url?: string;
  credential_ref?: string;
  enabled: boolean;
}

function toWire(entry: ProviderEntry): WireProvider {
  return {
    id: entry.id,
    kind: entry.kind,
    ...(entry.baseUrl === undefined ? {} : { base_url: entry.baseUrl }),
    ...(entry.credentialRef === undefined ? {} : { credential_ref: entry.credentialRef }),
    enabled: entry.enabled,
  };
}

function fromWire(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const v = raw as Record<string, unknown>;
  return {
    id: v.id,
    kind: v.kind,
    baseUrl: v.base_url ?? v.baseUrl,
    credentialRef: v.credential_ref ?? v.credentialRef,
    enabled: v.enabled,
  };
}

function refusal(
  request: FastifyRequest,
  detail: string,
  rule: string,
  status = 400,
): ReturnType<typeof problem> {
  return problem({
    type: 'https://dokima.dev/errors/provider-registry',
    title: 'Provider registry refused the write',
    status,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
    rule,
  });
}

/**
 * Scans the whole submitted payload for credential-shaped strings BEFORE any
 * validation or persistence. `credentialRef` is a keychain NAME; if a caller
 * pastes the key itself into any field, the write is refused wholesale — not
 * partially applied with the offending field dropped, which would leave the
 * caller believing their credential was accepted.
 */
function findSecretBearingField(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) return undefined;
  for (const [i, item] of payload.entries()) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (typeof value === 'string' && looksLikeSecret(value)) return `[${i}].${key}`;
    }
  }
  return undefined;
}

export function registerProvidersRoutes(
  app: FastifyInstance,
  opts: ProvidersRoutesOptions = {},
): void {
  app.get(
    '/api/v1/projects/:id/providers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const entries = await listProviders(projectPath);
      return reply.send({ providers: entries.map(toWire) });
    },
  );

  app.put(
    '/api/v1/projects/:id/providers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;

      const body = request.body as { providers?: unknown } | undefined;
      const submitted = body?.providers;

      // Credential check first — before validation, before the store.
      const secretField = findSecretBearingField(submitted);
      if (secretField !== undefined) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            refusal(
              request,
              `${secretField} looks like a literal credential. Store the secret in the OS keychain and send its name as credential_ref — Dokima never persists a credential (FR-S2).`,
              'literal-credential-refused',
            ),
          );
      }

      // D-019: Copilot cannot be enabled without an existing ledgered ack.
      const projectSettings = await getProjectSettings(projectPath);
      const consented: ProviderKind[] =
        projectSettings.copilotEnabled === true ? ['copilot'] : [];

      let validated: ProviderEntry[];
      try {
        validated = validateProviderRegistry(
          Array.isArray(submitted) ? submitted.map(fromWire) : submitted,
          consented,
        );
      } catch (err) {
        if (err instanceof ProviderRegistryError) {
          return reply
            .code(err.rule === 'consent-required' ? 403 : 400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              refusal(
                request,
                err.message,
                err.rule,
                err.rule === 'consent-required' ? 403 : 400,
              ),
            );
        }
        throw err;
      }

      const saved = await putProviders(projectPath, validated);
      return reply.send({ providers: saved.map(toWire) });
    },
  );

  app.delete(
    '/api/v1/projects/:id/providers/:providerId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, providerId } = request.params as { id: string; providerId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const { removed } = await removeProvider(projectPath, providerId);
      if (!removed) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            problem({
              type: 'https://dokima.dev/errors/not-found',
              title: 'Provider not found',
              status: 404,
              detail: `no provider registered with id ${providerId}`,
              instance: request.url,
              requestId: request.id.toString(),
            }),
          );
      }
      return reply.code(204).send();
    },
  );
}
