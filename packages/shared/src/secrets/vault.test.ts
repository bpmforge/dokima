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
  const projectDir = await mkTmp();
  const store = createInMemoryCredentialStore();
  const vault = createProjectSecretsVault(store, projectDir, { SHIPWRIGHT_HOME: home });
  return { vault, store, home, projectDir };
}

describe('createProjectSecretsVault', () => {
  it('registers a secret and resolves it by name via the credential store', async () => {
    const { vault, store } = await makeVault();
    await vault.register('github-pat', 'ghp_fake');
    expect(await vault.get('github-pat')).toBe('ghp_fake');
    // The stored ref is namespaced by project, not the bare secret name.
    expect(await store.get('shipwright-project-secret:github-pat')).toBeUndefined();
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
    const projectDir = await mkTmp();
    const storeA = createInMemoryCredentialStore();
    const vaultA = createProjectSecretsVault(storeA, projectDir, {
      SHIPWRIGHT_HOME: home,
    });
    await vaultA.register('a', 'secret-a');

    const storeB = createInMemoryCredentialStore();
    const vaultB = createProjectSecretsVault(storeB, projectDir, {
      SHIPWRIGHT_HOME: home,
    });
    // storeB is a distinct credential-store instance (no value for 'a'),
    // but the on-disk index for this same project reports the name.
    expect(await vaultB.listNames()).toEqual(['a']);
  });

  it('never collides across two different projects sharing one credential store and SHIPWRIGHT_HOME', async () => {
    const home = await mkTmp();
    const projectA = await mkTmp();
    const projectB = await mkTmp();
    const store = createInMemoryCredentialStore();
    const vaultA = createProjectSecretsVault(store, projectA, { SHIPWRIGHT_HOME: home });
    const vaultB = createProjectSecretsVault(store, projectB, { SHIPWRIGHT_HOME: home });

    await vaultA.register('github-pat', 'project-a-secret');
    await vaultB.register('github-pat', 'project-b-secret');

    expect(await vaultA.get('github-pat')).toBe('project-a-secret');
    expect(await vaultB.get('github-pat')).toBe('project-b-secret');
    expect(await vaultA.listNames()).toEqual(['github-pat']);
    expect(await vaultA.listValues()).toEqual(['project-a-secret']);
    expect(await vaultB.listValues()).toEqual(['project-b-secret']);
  });
});
