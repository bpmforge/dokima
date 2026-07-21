/**
 * Shared provider-config resolution for `shipwright doctor`'s reachability
 * check and `shipwright providers refresh` (DEPLOYMENT.md §7/§8). There is
 * no persisted provider registry yet anywhere in the codebase — this reuses
 * the existing three-scope settings resolver (`getEffectiveSettings` /
 * `resolveEffectiveValue`, project overrides global) against a `providers`
 * key rather than inventing a new config file. No entries configured is a
 * normal, unconfigured state (local-first honesty, DEPLOYMENT.md §1's
 * "provider onboarding" hasn't run yet) — never treated as a failure.
 */

import {
  createLmStudioProvider,
  createOaiCompatProvider,
  createOllamaProvider,
  type Provider,
} from '@shipwright/gateway';
import { getEffectiveSettings, resolveEffectiveValue } from '@shipwright/shared';
import type { CliIO } from '../../bootstrap/cli.js';

export const PROVIDERS_SETTINGS_KEY = 'providers';

export type ProviderConfigKind = 'ollama' | 'lm-studio' | 'oai-compat';

export interface ProviderConfigEntry {
  id: string;
  kind: ProviderConfigKind;
  baseUrl?: string;
}

function isProviderConfigEntry(value: unknown): value is ProviderConfigEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    (v.kind === 'ollama' || v.kind === 'lm-studio' || v.kind === 'oai-compat') &&
    (v.baseUrl === undefined || typeof v.baseUrl === 'string')
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

/** Constructs the real `Provider` adapter for a configured entry (FR-G1's uniform provider interface). */
export function buildProvider(entry: ProviderConfigEntry): Provider {
  switch (entry.kind) {
    case 'ollama':
      return createOllamaProvider(entry.baseUrl ? { baseUrl: entry.baseUrl } : {});
    case 'lm-studio':
      return createLmStudioProvider(entry.baseUrl ? { baseUrl: entry.baseUrl } : {});
    case 'oai-compat':
      return createOaiCompatProvider({ id: entry.id, baseUrl: entry.baseUrl ?? '' });
  }
}
