/**
 * Provider registry persistence (W10-01).
 *
 * Stored as the existing `providers` settings key rather than a new table, on
 * purpose: `apps/server/src/cli/ops/providers-core.ts` already reads that key
 * via `getEffectiveSettings` for `dokima doctor` and `dokima providers
 * refresh`. Writing anywhere else would have created a second source of truth
 * where the GUI and the CLI disagree about which providers exist. Reusing the
 * key also means no migration, and it inherits three things the settings
 * engine already guarantees: run>project>global precedence (FR-S1), a
 * `settings.changed` audit event on every write (FR-S3), and the file layer's
 * refusal to persist secret-shaped values (FR-S2 / Law 8).
 *
 * Credentials are never stored here — an entry carries `credentialRef`, a
 * NAME the keychain resolves at call time.
 */

import { validateProviderRegistry, type ProviderEntry } from '@dokima/gateway';
import type { JsonValue } from '@dokima/shared';
import { getProjectSettings, putProjectSetting } from './settings-scope.js';

export const PROVIDERS_SETTINGS_KEY = 'providers';

/**
 * Reads the registry. A malformed stored value degrades to an empty registry
 * rather than throwing: an unreadable setting must not take the whole
 * settings surface down, and "no providers configured" is a normal,
 * first-run state (local-first honesty, C-1) — never an error.
 */
export async function listProviders(projectPath: string): Promise<ProviderEntry[]> {
  const settings = await getProjectSettings(projectPath);
  const raw = settings[PROVIDERS_SETTINGS_KEY];
  if (raw === undefined) return [];
  try {
    return validateProviderRegistry(raw);
  } catch {
    return [];
  }
}

/**
 * Replaces the registry wholesale. The caller validates first (so a refusal
 * is explainable with its rule); this re-validates because a store that
 * trusts its caller is one refactor away from persisting garbage.
 */
export async function putProviders(
  projectPath: string,
  entries: readonly ProviderEntry[],
): Promise<ProviderEntry[]> {
  const validated = validateProviderRegistry(entries);
  await putProjectSetting(
    projectPath,
    PROVIDERS_SETTINGS_KEY,
    validated as unknown as JsonValue,
  );
  return validated;
}

/** Removes one entry by id. Returns the surviving registry; unknown id is a no-op miss the caller reports as 404. */
export async function removeProvider(
  projectPath: string,
  id: string,
): Promise<{ removed: boolean; entries: ProviderEntry[] }> {
  const current = await listProviders(projectPath);
  if (!current.some((e) => e.id === id)) return { removed: false, entries: current };
  const next = current.filter((e) => e.id !== id);
  await putProviders(projectPath, next);
  return { removed: true, entries: next };
}
