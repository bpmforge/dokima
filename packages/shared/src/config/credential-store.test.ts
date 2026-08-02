import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CredentialRefNotFoundError,
  NoKeychainAdapterError,
  VaultKeyMissingError,
  createEncryptedFileCredentialStore,
  createInMemoryCredentialStore,
  createMacKeychainCredentialStore,
  resolveCredentialRef,
  resolveCredentialStore,
} from './credential-store.js';

let tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-vault-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('resolveCredentialRef', () => {
  it('returns the stored secret for a known ref', async () => {
    const store = createInMemoryCredentialStore();
    await store.set('dokima:copilot:github-token', 'ghp_fake');
    expect(await resolveCredentialRef(store, 'dokima:copilot:github-token')).toBe(
      'ghp_fake',
    );
  });

  it('throws a named-ref error rather than falling back to plaintext when the ref is unset', async () => {
    const store = createInMemoryCredentialStore();
    await expect(
      resolveCredentialRef(store, 'dokima:missing'),
    ).rejects.toBeInstanceOf(CredentialRefNotFoundError);
  });

  it('deleting a ref breaks resolution with the same named-ref error (never plaintext)', async () => {
    const store = createInMemoryCredentialStore();
    await store.set('dokima:vertex:adc', 'secret-value');
    await store.delete('dokima:vertex:adc');
    await expect(
      resolveCredentialRef(store, 'dokima:vertex:adc'),
    ).rejects.toBeInstanceOf(CredentialRefNotFoundError);
  });
});

describe('encrypted-file credential store', () => {
  it('round-trips a secret through set/get', async () => {
    const home = await mkTmp();
    const env = { DOKIMA_HOME: home, DOKIMA_VAULT_KEY: 'test-vault-key' };
    const store = createEncryptedFileCredentialStore(env);

    await store.set('dokima:copilot:github-token', 'ghp_fake_token_value');
    expect(await store.get('dokima:copilot:github-token')).toBe(
      'ghp_fake_token_value',
    );
  });

  it('persists across separate store instances backed by the same file + key', async () => {
    const home = await mkTmp();
    const env = { DOKIMA_HOME: home, DOKIMA_VAULT_KEY: 'test-vault-key' };

    await createEncryptedFileCredentialStore(env).set('ref-a', 'value-a');
    const secondInstance = createEncryptedFileCredentialStore(env);
    expect(await secondInstance.get('ref-a')).toBe('value-a');
  });

  it('the on-disk vault file never contains the plaintext secret', async () => {
    const home = await mkTmp();
    const env = { DOKIMA_HOME: home, DOKIMA_VAULT_KEY: 'test-vault-key' };
    await createEncryptedFileCredentialStore(env).set(
      'dokima:copilot:github-token',
      'ghp_super_secret_value_1234567890',
    );

    const raw = await fs.readFile(path.join(home, 'vault.json'), 'utf8');
    expect(raw).not.toContain('ghp_super_secret_value_1234567890');
  });

  it('delete removes the entry', async () => {
    const home = await mkTmp();
    const env = { DOKIMA_HOME: home, DOKIMA_VAULT_KEY: 'test-vault-key' };
    const store = createEncryptedFileCredentialStore(env);
    await store.set('ref-a', 'value-a');
    await store.delete('ref-a');
    expect(await store.get('ref-a')).toBeUndefined();
  });

  it('throws VaultKeyMissingError when DOKIMA_VAULT_KEY is not set', () => {
    expect(() => createEncryptedFileCredentialStore({})).toThrow(VaultKeyMissingError);
  });

  it('cannot decrypt with the wrong vault key', async () => {
    const home = await mkTmp();
    await createEncryptedFileCredentialStore({
      DOKIMA_HOME: home,
      DOKIMA_VAULT_KEY: 'correct-key',
    }).set('ref-a', 'value-a');

    const wrongKeyStore = createEncryptedFileCredentialStore({
      DOKIMA_HOME: home,
      DOKIMA_VAULT_KEY: 'wrong-key',
    });
    await expect(wrongKeyStore.get('ref-a')).rejects.toThrow();
  });
});

describe('resolveCredentialStore', () => {
  it('uses the encrypted-file vault when DOKIMA_NO_KEYCHAIN is set', async () => {
    const home = await mkTmp();
    const env = {
      DOKIMA_NO_KEYCHAIN: '1',
      DOKIMA_HOME: home,
      DOKIMA_VAULT_KEY: 'test-vault-key',
    };
    const store = resolveCredentialStore(env);
    await store.set('ref-a', 'value-a');
    expect(await store.get('ref-a')).toBe('value-a');
  });

  it('selects the macOS keychain adapter on darwin (not invoked — would touch the real keychain)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const store = resolveCredentialStore({});
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.delete).toBe('function');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('fails loudly (never a silent plaintext fallback) on a platform with no adapter', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(() => resolveCredentialStore({})).toThrow(NoKeychainAdapterError);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

// Opt-in only: exercises the real macOS Keychain via the `security` CLI.
// Skipped by default so `pnpm test` never touches a developer's real
// keychain or requires an unlocked login keychain in CI.
describe.skipIf(
  process.platform !== 'darwin' || process.env.DOKIMA_TEST_REAL_KEYCHAIN !== '1',
)('macOS keychain credential store (real keychain, opt-in)', () => {
  it('round-trips a secret through the real keychain', async () => {
    const store = createMacKeychainCredentialStore();
    const ref = `dokima-test-${Date.now()}`;
    try {
      await store.set(ref, 'integration-test-value');
      expect(await store.get(ref)).toBe('integration-test-value');
    } finally {
      await store.delete(ref);
    }
  });
});
