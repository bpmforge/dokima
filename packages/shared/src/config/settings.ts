/**
 * Core value/scope model for the three-scope settings system (FR-S1,
 * BLUEPRINT §3.10). No deep merging across scopes: a key resolves
 * atomically to the whole value held by the highest-precedence scope that
 * defines it — "for any (global, project, run) triple the effective value
 * is the highest-precedence defined one" (SRS FR-S1 verify clause).
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A single scope's settings: flat map of dotted key -> JSON value. */
export type SettingsMap = Record<string, JsonValue>;

export type SettingsScope = 'global' | 'project' | 'run';

/** run > project > global (FR-S1). */
export const SCOPE_PRECEDENCE: readonly SettingsScope[] = ['run', 'project', 'global'];

export interface ScopedSettings {
  global?: SettingsMap;
  project?: SettingsMap;
  run?: SettingsMap;
}

export interface ResolvedSetting {
  value: JsonValue;
  scope: SettingsScope;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (type === 'object') {
    // Reject class instances (Map, Set, Date, ...) — only plain object
    // literals (or JSON.parse output) count as JSON objects.
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

export function isSettingsMap(value: unknown): value is SettingsMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isJsonValue)
  );
}

/** The winning scope + value for one key, or undefined if no scope defines it. */
export function resolveEffectiveValue(
  key: string,
  settings: ScopedSettings,
): ResolvedSetting | undefined {
  for (const scope of SCOPE_PRECEDENCE) {
    const value = settings[scope]?.[key];
    if (value !== undefined) return { value, scope };
  }
  return undefined;
}

/** Resolves every key defined in any scope; the UI "why is this on scope X" inspector. */
export function resolveEffectiveSettings(
  settings: ScopedSettings,
): Map<string, ResolvedSetting> {
  const keys = new Set<string>();
  for (const scope of SCOPE_PRECEDENCE) {
    const map = settings[scope];
    if (map) for (const key of Object.keys(map)) keys.add(key);
  }
  const resolved = new Map<string, ResolvedSetting>();
  for (const key of keys) {
    const value = resolveEffectiveValue(key, settings);
    if (value) resolved.set(key, value);
  }
  return resolved;
}
