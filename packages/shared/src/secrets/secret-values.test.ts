import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryCredentialStore } from '../config/credential-store.js';
import { collectSecretValues } from './secret-values.js';
import { createProjectSecretsVault } from './vault.js';

let tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-secret-values-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('collectSecretValues', () => {
  it('combines vault-registered secrets and project .env values', async () => {
    const home = await mkTmp();
    const projectDir = await mkTmp();
    const vault = createProjectSecretsVault(createInMemoryCredentialStore(), projectDir, {
      DOKIMA_HOME: home,
    });
    await vault.register('forge-token', 'vault-secret-value');
    await fs.writeFile(path.join(projectDir, '.env'), 'DB_PASSWORD=env-secret-value\n');

    const values = await collectSecretValues(vault, projectDir);
    expect(values.sort()).toEqual(['env-secret-value', 'vault-secret-value']);
  });

  it('returns only vault values when the project has no .env file', async () => {
    const home = await mkTmp();
    const projectDir = await mkTmp();
    const vault = createProjectSecretsVault(createInMemoryCredentialStore(), projectDir, {
      DOKIMA_HOME: home,
    });
    await vault.register('a', 'only-secret');

    expect(await collectSecretValues(vault, projectDir)).toEqual(['only-secret']);
  });
});
