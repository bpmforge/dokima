/**
 * Thin wrapper over @shipwright/shared's three-scope settings engine
 * (FR-S1..S3) — the generic run>project>global resolver, file-backed
 * global/project scopes, and settings.changed audit event all already
 * exist there (W0-07); this module just wires apps/server's project
 * resolution + the real event sink (settings-events.ts) around it, and
 * builds the "why this value" payload API_DESIGN §105-108 specifies.
 */

import {
  getEffectiveSettings,
  loadGlobalConfig,
  loadProjectSettings,
  resolveEffectiveSettings,
  SCOPE_PRECEDENCE,
  writeGlobalSetting,
  writeProjectSetting,
  type JsonValue,
  type SettingsMap,
  type SettingsScope,
} from '@shipwright/shared';
import { DEFAULT_ACTOR_ID, createProjectSettingsEventSink } from './settings-events.js';

export async function getProjectSettings(projectPath: string): Promise<SettingsMap> {
  return loadProjectSettings(projectPath);
}

export async function putProjectSetting(
  projectPath: string,
  key: string,
  value: JsonValue | undefined,
): Promise<SettingsMap> {
  await writeProjectSetting(projectPath, {
    key,
    value,
    actorId: DEFAULT_ACTOR_ID,
    sink: createProjectSettingsEventSink(projectPath),
  });
  return loadProjectSettings(projectPath);
}

export async function getGlobalSettings(): Promise<SettingsMap> {
  return loadGlobalConfig();
}

/** `loggingProjectPath` is optional — v1 has no "every open project" fan-out mechanism (DATABASE.md §7's aspirational broadcast), so a global-scope write is audited to one project's log when the caller has one in view, and otherwise left unaudited (documented gap, not a silent one). */
export async function putGlobalSetting(
  key: string,
  value: JsonValue | undefined,
  loggingProjectPath?: string,
): Promise<SettingsMap> {
  await writeGlobalSetting({
    key,
    value,
    actorId: DEFAULT_ACTOR_ID,
    sink: loggingProjectPath
      ? createProjectSettingsEventSink(loggingProjectPath)
      : undefined,
  });
  return loadGlobalConfig();
}

export interface EffectiveEntry {
  readonly value: JsonValue;
  readonly winningScope: SettingsScope;
  readonly overridden: readonly {
    readonly scope: SettingsScope;
    readonly value: JsonValue;
  }[];
}

/** API_DESIGN §108: every settings key -> {value, winning_scope, overridden}. */
export async function getEffectiveProjectSettings(
  projectPath: string,
  run?: SettingsMap,
): Promise<Record<string, EffectiveEntry>> {
  const scoped = await getEffectiveSettings({ projectDir: projectPath, run });
  const resolved = resolveEffectiveSettings(scoped);
  const result: Record<string, EffectiveEntry> = {};
  for (const [key, entry] of resolved) {
    const overridden = SCOPE_PRECEDENCE.filter((scope) => scope !== entry.scope)
      .map((scope) => ({ scope, value: scoped[scope]?.[key] }))
      .filter(
        (row): row is { scope: SettingsScope; value: JsonValue } =>
          row.value !== undefined,
      );
    result[key] = { value: entry.value, winningScope: entry.scope, overridden };
  }
  return result;
}
