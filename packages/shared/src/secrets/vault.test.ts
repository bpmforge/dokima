import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryCredentialStore } from '../config/credential-store.js';
import { createProjectSecretsVault } from './vault.js';

let tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-secrets-vault-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

async function makeVault() {
  const home = await mkTmp();
  const store = createInMemoryCredentialStore();
  const vault = createProjectSecretsVault(store, { SHIPWRIGHT_HOME: home });
  return { vault, store, home };
}

describe('createProjectSecretsVault', () => {
  it('registers a secret and resolves it by name via the credential store', async () => {
    const { vault, store } = await makeVault();
    await vault.register('github-pat', 'ghp_fake');
    expect(await vault.get('github-pat')).toBe('ghp_fake');
    expect(await store.get('shipwright-project-secret:github-pat')).toBe('ghp_fake');
  });

  it('lists registered names without ever touching values', async () => {
    const { vault } = await makeVault();
    await vault.register('a', 'value-a');
    await vault.register('b', 'value-b');
    expect(await vault.listNames()).toEqual(['a', 'b']);
  });

  it('does not duplicate a name in the index on re-register', async () => {
    const { vault } = await makeVault();
    await vault.register('a', 'value-1');
    await vault.register('a', 'value-2');
    expect(await vault.listNames()).toEqual(['a']);
    expect(await vault.get('a')).toBe('value-2');
  });

  it('lists all registered values for redaction', async () => {
    const { vault } = await makeVault();
    await vault.register('a', 'secret-a');
    await vault.register('b', 'secret-b');
    expect(await vault.listValues()).toEqual(['secret-a', 'secret-b']);
  });

  it('delete removes both the credential and the name from the index', async () => {
    const { vault } = await makeVault();
    await vault.register('a', 'secret-a');
    await vault.delete('a');
    expect(await vault.get('a')).toBeUndefined();
    expect(await vault.listNames()).toEqual([]);
  });

  it('persists the name index to disk under SHIPWRIGHT_HOME, independent of the credential store instance', async () => {
    const home = await mkTmp();
    const storeA = createInMemoryCredentialStore();
    const vaultA = createProjectSecretsVault(storeA, { SHIPWRIGHT_HOME: home });
    await vaultA.register('a', 'secret-a');

    const storeB = createInMemoryCredentialStore();
    await storeB.set('shipwright-project-secret:a', 'secret-a');
    const vaultB = createProjectSecretsVault(storeB, { SHIPWRIGHT_HOME: home });
    expect(await vaultB.listNames()).toEqual(['a']);
  });
});
