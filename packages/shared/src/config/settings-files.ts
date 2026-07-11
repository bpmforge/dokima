/**
 * File-backed global/project settings scopes (FR-S1, BLUEPRINT §3.10).
 * Global: `~/.shipwright/config.json` (relocatable via SHIPWRIGHT_HOME for
 * CI/tests, docs/DEPLOYMENT.md §6). Project: `<repo>/.shipwright/settings.json`.
 *
 * FR-S2: credential refs (strings naming a keychain entry) are the only
 * thing these files may hold for secrets. `writeSettingsFile` refuses to
 * persist a value that looks like an actual secret rather than a ref, so
 * "settings files never contain secrets" is enforced at the write path,
 * not just asserted by a scanner run later.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSettingsMap, type SettingsMap } from './settings.js';

export const GLOBAL_CONFIG_FILENAME = 'config.json';
export const PROJECT_SETTINGS_DIRNAME = '.shipwright';
export const PROJECT_SETTINGS_FILENAME = 'settings.json';

export function computeShipwrightHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHIPWRIGHT_HOME ?? path.join(os.homedir(), '.shipwright');
}

export function computeGlobalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(computeShipwrightHome(env), GLOBAL_CONFIG_FILENAME);
}

export function computeProjectSettingsPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_SETTINGS_DIRNAME, PROJECT_SETTINGS_FILENAME);
}

// Known credential/secret shapes (SC-06). This is a defensive write-path
// guard, not the full redaction/scanner system (that lands in W8-03).
const SECRET_LIKE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/, // OpenAI/Anthropic-style secret keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
];

export function looksLikeSecret(value: string): boolean {
  return SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(value));
}

export function findSecretLikeKeys(map: SettingsMap): string[] {
  const hits: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === 'string' && looksLikeSecret(value)) hits.push(key);
  }
  return hits;
}

export class SettingsFileSecretError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly keys: string[],
  ) {
    super(
      `refusing to write secret-shaped value(s) to settings file ${filePath}: ${keys.join(', ')} — store secrets in the OS keychain and reference them by name (FR-S2)`,
    );
    this.name = 'SettingsFileSecretError';
  }
}

export class SettingsFileShapeError extends Error {
  constructor(public readonly filePath: string) {
    super(`invalid settings file shape at ${filePath}: expected a flat JSON object`);
    this.name = 'SettingsFileShapeError';
  }
}

async function readSettingsFile(filePath: string): Promise<SettingsMap> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isSettingsMap(parsed)) {
    throw new SettingsFileShapeError(filePath);
  }
  return parsed;
}

async function writeSettingsFile(filePath: string, map: SettingsMap): Promise<void> {
  const secretKeys = findSecretLikeKeys(map);
  if (secretKeys.length > 0) {
    throw new SettingsFileSecretError(filePath, secretKeys);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

export async function loadGlobalConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SettingsMap> {
  return readSettingsFile(computeGlobalConfigPath(env));
}

export async function saveGlobalConfig(
  map: SettingsMap,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return writeSettingsFile(computeGlobalConfigPath(env), map);
}

export async function loadProjectSettings(projectDir: string): Promise<SettingsMap> {
  return readSettingsFile(computeProjectSettingsPath(projectDir));
}

export async function saveProjectSettings(
  projectDir: string,
  map: SettingsMap,
): Promise<void> {
  return writeSettingsFile(computeProjectSettingsPath(projectDir), map);
}
