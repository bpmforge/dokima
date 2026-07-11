/**
 * Orchestration layer: ties the file-backed scopes (settings-files.ts),
 * the resolver (settings.ts), and the audit sink (events.ts) together.
 */

import {
  loadGlobalConfig,
  loadProjectSettings,
  saveGlobalConfig,
  saveProjectSettings,
} from './settings-files.js';
import { noopSettingsEventSink, type SettingsEventSink } from './events.js';
import {
  type JsonValue,
  type ScopedSettings,
  type SettingsMap,
  type SettingsScope,
} from './settings.js';

export interface WriteSettingOptions {
  key: string;
  /** undefined removes the key from this scope's file. */
  value: JsonValue | undefined;
  actorId: string;
  sink?: SettingsEventSink;
}

async function applyAndEmit(
  scope: SettingsScope,
  current: SettingsMap,
  options: WriteSettingOptions,
  save: (next: SettingsMap) => Promise<void>,
): Promise<void> {
  const previousValue = current[options.key];
  const next: SettingsMap = { ...current };
  if (options.value === undefined) {
    delete next[options.key];
  } else {
    next[options.key] = options.value;
  }
  await save(next);

  const sink = options.sink ?? noopSettingsEventSink;
  await sink.emit({
    type: 'settings.changed',
    scope,
    key: options.key,
    previousValue,
    nextValue: options.value,
    actorId: options.actorId,
    occurredAt: new Date().toISOString(),
  });
}

export async function writeGlobalSetting(
  options: WriteSettingOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const current = await loadGlobalConfig(env);
  await applyAndEmit('global', current, options, (next) => saveGlobalConfig(next, env));
}

export async function writeProjectSetting(
  projectDir: string,
  options: WriteSettingOptions,
): Promise<void> {
  const current = await loadProjectSettings(projectDir);
  await applyAndEmit('project', current, options, (next) =>
    saveProjectSettings(projectDir, next),
  );
}

export interface EffectiveSettingsQuery {
  env?: NodeJS.ProcessEnv;
  projectDir?: string;
  run?: SettingsMap;
}

/** Loads global + (optionally) project scopes from disk and pairs them with the ephemeral run scope. */
export async function getEffectiveSettings(
  query: EffectiveSettingsQuery = {},
): Promise<ScopedSettings> {
  const env = query.env ?? process.env;
  const [global, project] = await Promise.all([
    loadGlobalConfig(env),
    query.projectDir ? loadProjectSettings(query.projectDir) : Promise.resolve(undefined),
  ]);
  return { global, project, run: query.run };
}
