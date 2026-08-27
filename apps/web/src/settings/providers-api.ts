/**
 * Provider registry + model catalog REST client (W10-04, FR-G1, D-007,
 * D-019, UX_SPEC §6a). Mirrors api.ts's conventions.
 *
 * `ProviderKind` hand-mirrors `@dokima/gateway`'s `PROVIDER_KINDS`
 * (packages/gateway/src/registry/types.ts) rather than importing it: apps/web
 * has no dependency path to `@dokima/gateway` (ARCHITECTURE §4 — web talks to
 * the server over REST/WS only), same precedent as board/types.ts and
 * `packages/gateway/src/routing/presets.ts`'s own comment about this ticket's
 * web-side `MODEL_MATRIX_PRESETS` mirror in `./types.ts`.
 */

import { jsonInit, request, type SettingsApiOptions } from './api-client.js';
// W12-25: the auth-method model moved to its own chapter when this file hit
// 421 lines. Re-exported so every existing consumer keeps its import path —
// the split is about file size, not about changing anyone's call sites.
export {
  AUTH_METHOD_LABEL,
  authMethodsFor,
  defaultAuthMethod,
  type AuthMethod,
} from './providers-auth-methods.js';

export {
  readInjectedToken,
  SettingsApiError,
  type SettingsApiOptions,
} from './api-client.js';

export type ProviderKind =
  'ollama' | 'lm-studio' | 'oai-compat' | 'anthropic' | 'openai' | 'vertex' | 'copilot';

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'ollama',
  'lm-studio',
  'oai-compat',
  'anthropic',
  'openai',
  'vertex',
  'copilot',
];

export const KIND_LABEL: Record<ProviderKind, string> = {
  ollama: 'Ollama (local)',
  'lm-studio': 'LM Studio (local)',
  'oai-compat': 'OpenAI-compatible endpoint',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  vertex: 'Vertex AI',
  copilot: 'GitHub Copilot (consent-gated)',
};

/** Kinds whose base URL is user-supplied rather than fixed (UX_SPEC §6a kind table). */
export const ENDPOINT_KINDS: readonly ProviderKind[] = ['oai-compat'];

/** Local kinds whose base URL is optional — a well-known default is prefilled and editable. */
export const LOCAL_DEFAULT_BASE_URL: Record<'ollama' | 'lm-studio', string> = {
  ollama: 'http://localhost:11434/v1',
  'lm-studio': 'http://localhost:1234/v1',
};

/** Kinds with no user-editable endpoint field at all (UX_SPEC §6a kind table). */
export function hasFixedEndpoint(kind: ProviderKind): boolean {
  return kind !== 'ollama' && kind !== 'lm-studio' && kind !== 'oai-compat';
}

export function needsBaseUrl(kind: ProviderKind): boolean {
  return (ENDPOINT_KINDS as readonly string[]).includes(kind);
}

/** Same shape the server enforces (packages/gateway/src/registry/validate.ts's `ID_RE`) — client-side check so a typo surfaces before the round trip. */
export function isValidProviderId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ProviderEntry {
  id: string;
  kind: ProviderKind;
  baseUrl?: string;
  credentialRef?: string;
  /** W12-25: GCP project/region, required for `vertex` — the registry rejects it without them (W12-14). */
  project?: string;
  location?: string;
  enabled: boolean;
}

/** Kinds addressed by a cloud project rather than a URL — mirrors gateway's `PROJECT_SCOPED_KINDS`. */
export function needsProjectScope(kind: ProviderKind): boolean {
  return kind === 'vertex';
}

interface WireProvider {
  id: string;
  kind: ProviderKind;
  base_url?: string;
  credential_ref?: string;
  /** W12-25: snake_case on the wire, same convention as `base_url`. */
  project?: string;
  location?: string;
  enabled: boolean;
}

function fromWireEntry(wire: WireProvider): ProviderEntry {
  return {
    id: wire.id,
    kind: wire.kind,
    ...(wire.base_url === undefined ? {} : { baseUrl: wire.base_url }),
    ...(wire.credential_ref === undefined ? {} : { credentialRef: wire.credential_ref }),
    // W12-25: both mappers are ALLOWLISTS, so a field omitted here is silently
    // dropped — the same "settable and inert" defect W10-57 documented in the
    // registry validator and W12-14 nearly repeated.
    ...(wire.project === undefined ? {} : { project: wire.project }),
    ...(wire.location === undefined ? {} : { location: wire.location }),
    enabled: wire.enabled,
  };
}

function toWireEntry(entry: ProviderEntry): WireProvider {
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

export async function fetchProviders(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<ProviderEntry[]> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/providers`,
    jsonInit('GET'),
    opts,
  )) as { providers: WireProvider[] };
  return wire.providers.map(fromWireEntry);
}

/**
 * W10-70. `scope` is omitted from the wire unless it is 'global', so the
 * default request stays byte-identical to the pre-ticket one and the server
 * reads an absent scope as project.
 */
export async function putProviders(
  projectId: string,
  entries: ProviderEntry[],
  opts: SettingsApiOptions & { scope?: 'project' | 'global' } = {},
): Promise<ProviderEntry[]> {
  const { scope, ...requestOpts } = opts;
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/providers`,
    jsonInit('PUT', {
      providers: entries.map(toWireEntry),
      ...(scope === 'global' ? { scope } : {}),
    }),
    requestOpts,
  )) as { providers: WireProvider[] };
  return wire.providers.map(fromWireEntry);
}

export async function deleteProvider(
  projectId: string,
  providerId: string,
  opts: SettingsApiOptions = {},
): Promise<void> {
  await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(providerId)}`,
    jsonInit('DELETE'),
    opts,
  );
}

export interface CatalogModel {
  id: string;
  contextLength?: number;
}

export type CatalogSource = 'discovered' | 'bundled' | null;

export interface ProviderCatalog {
  status: 'ok' | 'unreachable';
  source: CatalogSource;
  models: CatalogModel[];
  reason?: string;
}

/** Reachability chip text — never colour alone (UX_SPEC §6a §9): Reachable / Unreachable / Bundled / Not tested yet. */
export function reachability(
  catalog: ProviderCatalog | undefined,
  kind: ProviderKind,
): { chip: string; detail?: string } {
  if (!catalog) return { chip: 'Not tested yet' };
  if (catalog.status === 'ok') {
    if (catalog.models.length === 0) {
      const hint =
        kind === 'ollama' || kind === 'lm-studio'
          ? ' Pull or load a model on this endpoint, then Refresh.'
          : '';
      return { chip: 'Reachable', detail: `Reachable, but serves no models yet.${hint}` };
    }
    return { chip: 'Reachable' };
  }
  return {
    chip: catalog.source === 'bundled' ? 'Bundled' : 'Unreachable',
    detail: catalog.reason,
  };
}

/** The exact removal copy UX_SPEC §6a names — what it does and does not touch (C-6). */
export function removalCopy(entry: ProviderEntry): string {
  const keychain = entry.credentialRef
    ? `does not delete the keychain entry \`${entry.credentialRef}\``
    : 'has no keychain entry to preserve';
  return `Remove ${entry.id}? This deletes the endpoint from this project's registry and unbinds any matrix cell routing to it. It ${keychain}, does not touch the models on the endpoint itself, and does not alter any run that already happened — receipts and the event log are append-only (C-6).`;
}

interface WireCatalogModel {
  id: string;
  context_length?: number;
}

export async function fetchProviderModels(
  projectId: string,
  providerId: string,
  opts: SettingsApiOptions = {},
): Promise<ProviderCatalog> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(providerId)}/models`,
    jsonInit('GET'),
    opts,
  )) as {
    status: 'ok' | 'unreachable';
    source: CatalogSource;
    models: WireCatalogModel[];
    reason?: string;
  };
  return {
    status: wire.status,
    source: wire.source,
    models: wire.models.map((m) => ({
      id: m.id,
      ...(m.context_length === undefined ? {} : { contextLength: m.context_length }),
    })),
    ...(wire.reason === undefined ? {} : { reason: wire.reason }),
  };
}

/**
 * Writes a literal secret to the OS keychain (Law 8, FR-S2) and returns the
 * name it was stored under — the caller sends that name back as
 * `credentialRef` on the provider registry PUT, never the value itself.
 */
export async function registerCredential(
  projectId: string,
  name: string,
  value: string,
  opts: SettingsApiOptions = {},
): Promise<{ ref: string }> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/providers/credentials`,
    jsonInit('POST', { name, value }),
    opts,
  )) as { ref: string };
}

// --- catalog-derived helpers (UX_SPEC §6a "select ... from a LIST") -------

/**
 * Every model id known across *enabled* provider catalogs, deduped and
 * sorted — the LIST the model-matrix picker offers. A disabled provider's
 * models are excluded here (not merely hidden downstream): UX_SPEC §6a
 * "Provider disabled" says a disabled provider is a refusal to *use*, so it
 * must not be offered as a fresh selection, even though its row stays
 * visible in the Providers table. A row that *already* routes to a model a
 * disabled provider serves is a distinct case — see `findServingProviderId`
 * and the "unroutable" state it enables.
 */
// W21-24 chapter (CODE_BOOK_PROTOCOL 400-line cap): the model-ref rules moved
// to providers-model-refs.ts; re-exported so every import site keeps working.
export {
  combinedModelOptions,
  findServingProviderId,
  modelRefFor,
  splitModelRefLocal,
} from './providers-model-refs.js';

export interface ProviderDraftInput {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  enabled: boolean;
  /** The entry's credentialRef before this edit; undefined when adding fresh. */
  previousCredentialRef?: string;
  /** The name `registerCredential` returned for a freshly-typed API key — NEVER the raw key (Law 8). */
  registeredCredentialRef?: string;
  /** W12-25: only meaningful for a project-scoped kind. */
  project?: string;
  location?: string;
}

/**
 * Assembles the `ProviderEntry` a submit sends to `putProviders`. Pulled out
 * as a pure function so the Law 8 invariant — a credential field can only
 * ever be a ref, never a literal — is unit-testable without a DOM: the real
 * guarantee is structural (ProvidersPanel only ever calls this with
 * `registerCredential`'s resolved `{ ref }`, never `draft.apiKey` — see that
 * call site's test for the wiring proof).
 */
export function buildProviderEntry(input: ProviderDraftInput): ProviderEntry {
  const credentialRef = input.registeredCredentialRef ?? input.previousCredentialRef;
  return {
    id: input.id.trim(),
    kind: input.kind,
    enabled: input.enabled,
    ...(!hasFixedEndpoint(input.kind) && input.baseUrl.trim() !== ''
      ? { baseUrl: input.baseUrl.trim() }
      : {}),
    ...(credentialRef ? { credentialRef } : {}),
    // W12-25: sent only for the kinds that bill a cloud project. The registry
    // REQUIRES both for `vertex` and rejects the entry without them (W12-14),
    // so an empty box here surfaces as a named refusal rather than an entry
    // that saves and then cannot construct.
    ...(needsProjectScope(input.kind) && input.project?.trim()
      ? { project: input.project.trim() }
      : {}),
    ...(needsProjectScope(input.kind) && input.location?.trim()
      ? { location: input.location.trim() }
      : {}),
  };
}
