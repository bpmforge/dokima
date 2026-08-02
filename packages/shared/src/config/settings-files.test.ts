import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SettingsFileSecretError,
  SettingsFileShapeError,
  computeGlobalConfigPath,
  computeProjectSettingsPath,
  findSecretLikeKeys,
  loadGlobalConfig,
  loadProjectSettings,
  looksLikeSecret,
  saveGlobalConfig,
  saveProjectSettings,
} from './settings-files.js';

let tmpDirs: string[] = [];

async function mkTmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('global config file', () => {
  it('returns an empty map when the file does not exist', async () => {
    const home = await mkTmp('dokima-config-test-');
    const env = { DOKIMA_HOME: home };
    expect(await loadGlobalConfig(env)).toEqual({});
  });

  it('round-trips a written config through the expected path', async () => {
    const home = await mkTmp('dokima-config-test-');
    const env = { DOKIMA_HOME: home };
    await saveGlobalConfig({ 'matrix.preset': 'hybrid' }, env);

    expect(computeGlobalConfigPath(env)).toBe(path.join(home, 'config.json'));
    expect(await loadGlobalConfig(env)).toEqual({ 'matrix.preset': 'hybrid' });

    const raw = await fs.readFile(computeGlobalConfigPath(env), 'utf8');
    expect(JSON.parse(raw)).toEqual({ 'matrix.preset': 'hybrid' });
  });

  it('rejects a malformed (non-object) settings file rather than silently coercing it', async () => {
    const home = await mkTmp('dokima-config-test-');
    const env = { DOKIMA_HOME: home };
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, 'config.json'), '[1,2,3]\n', 'utf8');

    await expect(loadGlobalConfig(env)).rejects.toBeInstanceOf(SettingsFileShapeError);
  });
});

describe('project settings file', () => {
  it('returns an empty map when the file does not exist', async () => {
    const projectDir = await mkTmp('dokima-project-test-');
    expect(await loadProjectSettings(projectDir)).toEqual({});
  });

  it('writes to <project>/.dokima/settings.json', async () => {
    const projectDir = await mkTmp('dokima-project-test-');
    await saveProjectSettings(projectDir, { 'autonomy.dial': 'guided' });

    expect(computeProjectSettingsPath(projectDir)).toBe(
      path.join(projectDir, '.dokima', 'settings.json'),
    );
    expect(await loadProjectSettings(projectDir)).toEqual({ 'autonomy.dial': 'guided' });
  });
});

describe('secret-shaped value guard (FR-S2)', () => {
  it.each([
    ['sk-abcdefghijklmnopqrstuvwx', 'OpenAI/Anthropic-style key'],
    ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'GitHub token'],
    ['AKIAABCDEFGHIJKLMNOP', 'AWS access key id'],
    ['xoxb-111111111111-222222222222-abcdefghijklmnopqrstuvwx', 'Slack token'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'PEM header'],
  ])('flags %s (%s) as secret-shaped', (value) => {
    expect(looksLikeSecret(value)).toBe(true);
  });

  it('does not flag ordinary settings values or credential refs', () => {
    expect(looksLikeSecret('dokima:copilot:github-token')).toBe(false);
    expect(looksLikeSecret('hybrid')).toBe(false);
    expect(looksLikeSecret('4')).toBe(false);
  });

  it('finds the offending keys in a settings map', () => {
    const map = {
      'matrix.preset': 'hybrid',
      'provider.copilot.credentialRef': 'dokima:copilot:github-token',
      'provider.copilot.apiKey': 'sk-leaked1234567890abcdef',
    };
    expect(findSecretLikeKeys(map)).toEqual(['provider.copilot.apiKey']);
  });

  it('registering every provider type via credential refs finds zero secrets in either settings file', async () => {
    const home = await mkTmp('dokima-config-test-');
    const projectDir = await mkTmp('dokima-project-test-');
    const env = { DOKIMA_HOME: home };

    const global = {
      'providers.copilot.credentialRef': 'dokima:copilot:github-token',
      'providers.vertex.credentialRef': 'dokima:vertex:adc',
      'providers.lmstudio.baseUrl': 'http://localhost:1234',
    };
    const project = {
      'forge.credentialRef': 'dokima:forge:gitea-token',
      'mcp.servers': ['fs', 'browser'],
    };
    await saveGlobalConfig(global, env);
    await saveProjectSettings(projectDir, project);

    expect(findSecretLikeKeys(await loadGlobalConfig(env))).toEqual([]);
    expect(findSecretLikeKeys(await loadProjectSettings(projectDir))).toEqual([]);
  });

  it('refuses to write a settings file containing a secret-shaped value', async () => {
    const home = await mkTmp('dokima-config-test-');
    const env = { DOKIMA_HOME: home };

    await expect(
      saveGlobalConfig({ 'provider.copilot.apiKey': 'sk-leaked1234567890abcdef' }, env),
    ).rejects.toBeInstanceOf(SettingsFileSecretError);

    // Nothing should have been written.
    expect(await loadGlobalConfig(env)).toEqual({});
  });
});
