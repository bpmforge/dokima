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
  resolveProviderCatalog,
  validateProviderRegistry,
  type CatalogModel,
  type Provider,
  type ProviderEntry,
  type ProviderKind,
} from '@dokima/gateway';
import {
  createProjectSecretsVault,
  looksLikeSecret,
  resolveCredentialStore,
  type CredentialStore,
} from '@dokima/shared';
import { providerForConfig } from '../pipeline/gateway-model-port/provider.js';
import { PROBLEM_CONTENT_TYPE, problem } from '../problem.js';
import {
  listProjectProviders,
  listProviders,
  putGlobalProviders,
  putProviders,
  removeProvider,
} from './providers-store.js';
import { badRequest, resolveProjectOrProblem } from './settings-route-helpers.js';
import { getProjectSettings } from './settings-scope.js';

export interface ProvidersRoutesOptions {
  /** Overrides the fleet home — tests only. */
  home?: string;
  /** Injects a fake OS-keychain adapter — tests only; production resolves the real one lazily per request. */
  credentialStore?: CredentialStore;
  /** Scopes the vault's on-disk name index (DOKIMA_HOME) — tests only; production uses process.env. */
  env?: NodeJS.ProcessEnv;
}

interface WireProvider {
  id: string;
  kind: ProviderKind;
  base_url?: string;
  credential_ref?: string;
  /** W12-25: required for `vertex` — which GCP project and region get billed. */
  project?: string;
  location?: string;
  enabled: boolean;
}

function toWire(entry: ProviderEntry): WireProvider {
  return {
    id: entry.id,
    kind: entry.kind,
    ...(entry.baseUrl === undefined ? {} : { base_url: entry.baseUrl }),
    ...(entry.credentialRef === undefined ? {} : { credential_ref: entry.credentialRef }),
    ...(entry.project === undefined ? {} : { project: entry.project }),
    ...(entry.location === undefined ? {} : { location: entry.location }),
    enabled: entry.enabled,
  };
}

interface WireCatalogModel {
  id: string;
  context_length?: number;
}

function toWireModel(model: CatalogModel): WireCatalogModel {
  return {
    id: model.id,
    ...(model.contextLength === undefined ? {} : { context_length: model.contextLength }),
  };
}

/**
 * The model-listing provider for the catalog route (W12-15).
 *
 * DELEGATES to `providerForConfig` rather than switching on `entry.kind`
 * itself. This function used to be a hand-rolled copy of that dispatch — the
 * SECOND copy, duplicated because `cli/ops/providers-core.ts` was outside an
 * earlier ticket's write_scope — and it went stale the moment W12-11 made
 * cloud kinds constructible: it kept telling users `anthropic`/`openai`/
 * `copilot` were "not yet constructible from the pipeline" while the pipeline
 * constructed them. The whole test suite stayed green, because the assertion
 * covering that string tested the copy. A third copy is how a second one
 * happens, so there is now one dispatch and this calls it.
 *
 * Construction is LAZY, inside `listModels`, so a credential or configuration
 * refusal surfaces through `resolveProviderCatalog`'s existing catch path and
 * reaches the panel as an honest `reason` — rather than throwing before the
 * catalog resolver is even entered.
 */
function buildCatalogProvider(entry: ProviderEntry): Pick<Provider, 'listModels'> {
  return {
    async listModels() {
      const provider = await providerForConfig(
        {
          kind: entry.kind,
          baseUrl: entry.baseUrl ?? '',
          // Listing is what tells the user which models exist, so there is no
          // model to price yet. `purpose: 'listing'` resolves the credential
          // and carries no cost table; this provider must never serve a chat.
          model: '',
          providerId: entry.id,
          ...(entry.credentialRef ? { credentialRef: entry.credentialRef } : {}),
          ...(entry.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: entry.requestTimeoutMs }),
        },
        { purpose: 'listing' },
      );
      return provider.listModels();
    },
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
    // W12-25: another allowlist. Without these the browser could send a GCP
    // project, this mapper would drop it, and the registry would refuse the
    // entry for a field the user demonstrably filled in.
    project: v.project,
    location: v.location,
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

/** W10-70. Absent means project, so no existing caller changes behaviour. */
type ProviderScope = 'project' | 'global';

function parseScope(value: unknown): ProviderScope | undefined {
  if (value === undefined) return 'project';
  return value === 'project' || value === 'global' ? value : undefined;
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
      const [entries, own] = await Promise.all([
        listProviders(projectPath),
        listProjectProviders(projectPath),
      ]);
      // W10-70: which scope served these. An inherited provider is otherwise
      // indistinguishable from one registered here, and editing it silently
      // creates a project override — same reasoning as the matrix (W10-64).
      return reply.send({
        providers: entries.map(toWire),
        scope: own.length > 0 ? 'project' : 'global',
      });
    },
  );

  /**
   * GET .../providers/:providerId/models (W10-02 AC3, UX_SPEC §6a). Reuses
   * `resolveProviderCatalog` — the CLI's `providers refresh` was this
   * function's only caller before this route; now the browser can reach the
   * same discovered/bundled/honest-absence result the "Test" and "Refresh"
   * affordances need.
   */
  app.get(
    '/api/v1/projects/:id/providers/:providerId/models',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, providerId } = request.params as { id: string; providerId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const entries = await listProviders(projectPath);
      const entry = entries.find((e) => e.id === providerId);
      if (!entry) {
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
      const provider = buildCatalogProvider(entry);
      const result = await resolveProviderCatalog(entry.id, entry.kind, provider);
      return reply.send({
        status: result.status,
        source: result.source,
        models: result.models.map(toWireModel),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
    },
  );

  /**
   * POST .../providers/credentials (W10-04 self-block AC3, UX_SPEC §6a, Law
   * 8). Accepts the literal secret exactly once, registers it in the OS
   * keychain via `ProjectSecretsVault.register`, and returns only the name
   * the caller chose — the same name `vault.get`/`vault.delete` accept back,
   * and what the caller then sends as `credential_ref` on the provider
   * registry PUT. The value itself never touches `settings.json` or the
   * event log; this route doesn't open either.
   */
  app.post(
    '/api/v1/projects/:id/providers/credentials',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as { name?: unknown; value?: unknown } | undefined;
      const name = body?.name;
      const value = body?.value;
      if (
        typeof name !== 'string' ||
        name.trim() === '' ||
        typeof value !== 'string' ||
        value.trim() === ''
      ) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"name" and "value" must both be non-empty strings'));
      }
      const store = opts.credentialStore ?? resolveCredentialStore(opts.env);
      const vault = createProjectSecretsVault(store, projectPath, opts.env);
      await vault.register(name, value);
      return reply.send({ ref: name });
    },
  );

  app.put(
    '/api/v1/projects/:id/providers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;

      const body = request.body as { providers?: unknown; scope?: unknown } | undefined;
      const submitted = body?.providers;

      // W10-70, mirroring the model matrix (W10-64): absent means project, so
      // every existing caller — the panel before this ticket, the CLI, the e2e
      // specs — is unchanged, and an unrecognised value is refused rather than
      // silently downgraded to the narrower scope.
      const scope = parseScope(body?.scope);
      if (!scope) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            refusal(
              request,
              '"scope" must be "project" or "global" when present',
              'invalid-scope',
            ),
          );
      }

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

      const saved =
        scope === 'global'
          ? await putGlobalProviders(validated, projectPath)
          : await putProviders(projectPath, validated);
      return reply.send({ providers: saved.map(toWire), scope });
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
