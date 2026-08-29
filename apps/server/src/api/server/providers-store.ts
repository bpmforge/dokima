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
import {
  getEffectiveProjectSettings,
  getGlobalSettings,
  getProjectSettings,
  putGlobalSetting,
  putProjectSetting,
} from './settings-scope.js';

export const PROVIDERS_SETTINGS_KEY = 'providers';

/**
 * Validates a registry that IS present, and says so when it will not read
 * (W21-98).
 *
 * All three readers below already distinguished "nothing configured" from
 * "configured but unreadable" — the `raw === undefined` guard IS that test —
 * and then threw the distinction away, catching the validation error and
 * returning the same empty array. A user whose registry had gone invalid was
 * shown a Settings panel saying no providers were configured, which is the
 * one thing that was definitely not true, and the CLI/GUI divergence this
 * module's header exists to prevent is exactly what that looks like from the
 * outside.
 *
 * It still returns empty. A broken registry has no entries to offer and
 * throwing would take Settings down (FR-S4). What changes is that the reason
 * leaves the process instead of dying in a bare `catch`.
 */
function readRegistry(raw: unknown, scope: string): ProviderEntry[] {
  try {
    return validateProviderRegistry(raw);
  } catch (err) {
    console.error(`[settings] ${scope} provider registry could not be read:`, err);
    return [];
  }
}

/**
 * Reads the registry. A malformed stored value degrades to an empty registry
 * rather than throwing: an unreadable setting must not take the whole
 * settings surface down, and "no providers configured" is a normal,
 * first-run state (local-first honesty, C-1) — never an error.
 *
 * W10-62: reads the EFFECTIVE settings (run > project > global, FR-S1), not
 * the project file alone. It used to call `getProjectSettings`, which is
 * `loadProjectSettings` and nothing else — while `dokima doctor` and `dokima
 * providers refresh` read the same key through `getEffectiveSettings`, which
 * merges global. So a provider written to `~/.dokima/config.json` was
 * reported healthy by the CLI and invisible to the resolver, which took the
 * "nothing configured" branch and silently fell back to the env target: the
 * user was told their provider was fine and got a different model.
 *
 * That is the divergence this module's header says reusing the `providers`
 * key was meant to prevent — "a second source of truth where the GUI and the
 * CLI disagree about which providers exist" — reintroduced one scope down.
 * Reading at the same scope the CLI reads is what actually closes it.
 *
 * Precedence is unchanged and still project-wins: a project registry
 * overrides a global one of the same id, so a global fallback can never
 * quietly beat an explicit per-project choice.
 */
export async function listProviders(projectPath: string): Promise<ProviderEntry[]> {
  const effective = await getEffectiveProjectSettings(projectPath);
  const raw = effective[PROVIDERS_SETTINGS_KEY]?.value;
  if (raw === undefined) return [];
  return readRegistry(raw, 'effective');
}

/**
 * The project's OWN entries, ignoring any global registry (W10-70) — what the
 * PUT route diffs against, and what tells the GET which scope actually served.
 */
export async function listProjectProviders(
  projectPath: string,
): Promise<ProviderEntry[]> {
  const settings = await getProjectSettings(projectPath);
  const raw = settings[PROVIDERS_SETTINGS_KEY];
  if (raw === undefined) return [];
  return readRegistry(raw, 'project');
}

/**
 * The every-project registry (W10-70). W10-62 made this scope READABLE and
 * left no way to write it, so the only route to a global provider was
 * hand-editing `~/.dokima/config.json` — a read path with no write path.
 *
 * Same home and same mechanism as the model matrix's global preset (W10-64),
 * deliberately: the two halves of "register once, use everywhere" (FR-F3)
 * must not diverge in where they live or which scope wins.
 */
export async function listGlobalProviders(): Promise<ProviderEntry[]> {
  const raw = (await getGlobalSettings())[PROVIDERS_SETTINGS_KEY];
  if (raw === undefined) return [];
  return readRegistry(raw, 'global');
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

/**
 * Replaces the every-project registry. Re-validates for the same reason
 * `putProviders` does — and note it runs through the SAME
 * `validateProviderRegistry`, so a consent-gated kind (D-019) cannot be
 * smuggled in globally by a path the project-scope check would have refused.
 */
export async function putGlobalProviders(
  entries: readonly ProviderEntry[],
  loggingProjectPath?: string,
): Promise<ProviderEntry[]> {
  const validated = validateProviderRegistry(entries);
  await putGlobalSetting(
    PROVIDERS_SETTINGS_KEY,
    validated as unknown as JsonValue,
    loggingProjectPath,
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
