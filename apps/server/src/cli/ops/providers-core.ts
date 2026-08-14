/**
 * Shared provider-config resolution for `dokima doctor`'s reachability
 * check and `dokima providers refresh` (DEPLOYMENT.md §7/§8). There is
 * no persisted provider registry yet anywhere in the codebase — this reuses
 * the existing three-scope settings resolver (`getEffectiveSettings` /
 * `resolveEffectiveValue`, project overrides global) against a `providers`
 * key rather than inventing a new config file. No entries configured is a
 * normal, unconfigured state (local-first honesty, DEPLOYMENT.md §1's
 * "provider onboarding" hasn't run yet) — never treated as a failure.
 */

import type { Provider, ProviderKind } from '@dokima/gateway';
import { providerForConfig } from '../../api/pipeline/gateway-model-port/provider.js';
import { getEffectiveSettings, resolveEffectiveValue } from '@dokima/shared';
import type { CliIO } from '../../bootstrap/cli.js';

export const PROVIDERS_SETTINGS_KEY = 'providers';

/**
 * W12-17: every kind the registry can hold, not just the three this module
 * used to build. It was `'ollama' | 'lm-studio' | 'oai-compat'`, and
 * `isProviderConfigEntry` rejected anything else — so a registered
 * anthropic/openai/copilot entry was SILENTLY SKIPPED by
 * `loadConfiguredProviders` ("malformed entries are skipped, not fatal").
 * The visible consequence was `doctor` reporting a clean bill of health while
 * saying nothing at all about the provider the user actually configured, and
 * `providers refresh` never refreshing it. That was defensible while cloud
 * kinds could not be constructed; W12-11 made them constructible and nothing
 * updated this file, because it sat outside that ticket's write_scope.
 */
export type ProviderConfigKind = ProviderKind;

export interface ProviderConfigEntry {
  id: string;
  kind: ProviderConfigKind;
  baseUrl?: string;
  /** The NAME of a keychain entry (Law 8), never the secret. Cloud kinds need it to build at all. */
  credentialRef?: string;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<ProviderKind>([
  'ollama',
  'lm-studio',
  'oai-compat',
  'anthropic',
  'openai',
  'vertex',
  'copilot',
]);

function isProviderConfigEntry(value: unknown): value is ProviderConfigEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    KNOWN_KINDS.has(v.kind) &&
    (v.baseUrl === undefined || typeof v.baseUrl === 'string') &&
    (v.credentialRef === undefined || typeof v.credentialRef === 'string')
  );
}

/** Reads the effective `providers` array (project scope overrides global). Malformed entries are skipped, not fatal. */
export async function loadConfiguredProviders(io: CliIO): Promise<ProviderConfigEntry[]> {
  const scoped = await getEffectiveSettings({ env: io.env, projectDir: io.cwd });
  const resolved = resolveEffectiveValue(PROVIDERS_SETTINGS_KEY, scoped);
  if (!resolved || !Array.isArray(resolved.value)) return [];
  const entries: ProviderConfigEntry[] = [];
  for (const item of resolved.value) {
    if (isProviderConfigEntry(item)) entries.push(item);
  }
  return entries;
}

/**
 * Constructs the real `Provider` adapter for a configured entry (FR-G1's
 * uniform provider interface).
 *
 * DELEGATES to `providerForConfig` (W12-17). This was the THIRD independent
 * copy of the adapter dispatch — W12-11 fixed the first, W12-15 deleted the
 * second, and this one survived both because each ticket could only see the
 * copy inside its own write_scope. There is now one dispatch.
 *
 * `purpose: 'listing'` because both callers ask a provider about ITSELF —
 * `doctor` calls `health()`, `providers refresh` calls `listModels()` — and
 * neither sends a completion. A listing provider carries no cost table, so it
 * must never serve a chat; if a caller here ever needs inference, it must
 * pass `'inference'` and take the unpriced-model refusal that comes with it.
 */
export async function buildProvider(entry: ProviderConfigEntry): Promise<Provider> {
  return providerForConfig(
    {
      kind: entry.kind,
      baseUrl: entry.baseUrl ?? '',
      // No completion is issued on this path, so there is no model to price.
      model: '',
      providerId: entry.id,
      ...(entry.credentialRef ? { credentialRef: entry.credentialRef } : {}),
    },
    { purpose: 'listing' },
  );
}
