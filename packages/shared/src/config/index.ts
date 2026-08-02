export type {
  JsonPrimitive,
  JsonValue,
  ResolvedSetting,
  ScopedSettings,
  SettingsMap,
  SettingsScope,
} from './settings.js';
export {
  SCOPE_PRECEDENCE,
  isJsonValue,
  isSettingsMap,
  resolveEffectiveSettings,
  resolveEffectiveValue,
} from './settings.js';

export {
  GLOBAL_CONFIG_FILENAME,
  PROJECT_SETTINGS_DIRNAME,
  PROJECT_SETTINGS_FILENAME,
  SettingsFileSecretError,
  SettingsFileShapeError,
  computeGlobalConfigPath,
  computeProjectSettingsPath,
  computeDokimaHome,
  findSecretLikeKeys,
  loadGlobalConfig,
  loadProjectSettings,
  looksLikeSecret,
  saveGlobalConfig,
  saveProjectSettings,
} from './settings-files.js';

export type { SettingsChangedEvent, SettingsEventSink } from './events.js';
export { createInMemorySettingsEventSink, noopSettingsEventSink } from './events.js';

export type { EffectiveSettingsQuery, WriteSettingOptions } from './settings-service.js';
export {
  getEffectiveSettings,
  writeGlobalSetting,
  writeProjectSetting,
} from './settings-service.js';

export type { CredentialStore } from './credential-store.js';
export {
  CredentialRefNotFoundError,
  NoKeychainAdapterError,
  VaultKeyMissingError,
  createEncryptedFileCredentialStore,
  createInMemoryCredentialStore,
  createMacKeychainCredentialStore,
  resolveCredentialRef,
  resolveCredentialStore,
} from './credential-store.js';
