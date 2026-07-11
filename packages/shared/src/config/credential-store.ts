/**
 * Credential refs resolve via OS keychain, never a plaintext fallback
 * (FR-S2, SC-06, P-003). Settings files hold only the ref name; the actual
 * secret lives here.
 *
 * Two real backends:
 *  - macOS Keychain, via the `security` CLI (thin adapter; no native
 *    dependency — packages/shared/package.json is outside this ticket's
 *    write_scope, see plan.json W0-07 notes).
 *  - Encrypted-file vault (node:crypto AES-256-GCM), the headless/WSL
 *    fallback behind SHIPWRIGHT_NO_KEYCHAIN (P-003, DEPLOYMENT §6). This
 *    is also the backend exercised by the automated test suite: it is
 *    fully local, deterministic, and never touches a real OS keychain.
 *
 * Linux OS-keyring (libsecret/secret-tool) integration is deferred — see
 * the HANDOFF note on ticket W0-07. `resolveCredentialStore` fails loudly
 * (never silently falls back to plaintext) on platforms without an
 * adapter.
 */

import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { computeShipwrightHome } from './settings-files.js';

const execFileAsync = promisify(execFile);

export interface CredentialStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export class CredentialRefNotFoundError extends Error {
  constructor(public readonly ref: string) {
    super(
      `credential ref "${ref}" not found — register it before use (no plaintext fallback)`,
    );
    this.name = 'CredentialRefNotFoundError';
  }
}

/** Resolves a ref to its secret value; throws (never falls back to plaintext) when unset. */
export async function resolveCredentialRef(
  store: CredentialStore,
  ref: string,
): Promise<string> {
  const value = await store.get(ref);
  if (value === undefined) throw new CredentialRefNotFoundError(ref);
  return value;
}

/** In-memory fake for tests and callers that inject their own store. */
export function createInMemoryCredentialStore(): CredentialStore {
  const entries = new Map<string, string>();
  return {
    async get(ref) {
      return entries.get(ref);
    },
    async set(ref, value) {
      entries.set(ref, value);
    },
    async delete(ref) {
      entries.delete(ref);
    },
  };
}

const MAC_KEYCHAIN_SERVICE = 'shipwright';

/** macOS Keychain adapter (thin shell-out to `security`; no native dependency). */
export function createMacKeychainCredentialStore(): CredentialStore {
  return {
    async get(ref) {
      try {
        const { stdout } = await execFileAsync('security', [
          'find-generic-password',
          '-a',
          ref,
          '-s',
          MAC_KEYCHAIN_SERVICE,
          '-w',
        ]);
        return stdout.replace(/\n$/, '');
      } catch {
        // `security` exits non-zero for "not found" and for other failures
        // (locked keychain, denied access) alike; we cannot reliably tell
        // them apart from the CLI's exit status, and FR-S2 requires this
        // path to fail closed rather than guess — treat any failure as
        // "ref not found" so resolveCredentialRef raises a named-ref error.
        return undefined;
      }
    },
    async set(ref, value) {
      await execFileAsync('security', [
        'add-generic-password',
        '-a',
        ref,
        '-s',
        MAC_KEYCHAIN_SERVICE,
        '-w',
        value,
        '-U',
      ]);
    },
    async delete(ref) {
      try {
        await execFileAsync('security', [
          'delete-generic-password',
          '-a',
          ref,
          '-s',
          MAC_KEYCHAIN_SERVICE,
        ]);
      } catch {
        // Already absent: deletion is idempotent.
      }
    },
  };
}

const VAULT_FILENAME = 'vault.json';

interface VaultFilePayload {
  version: 1;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function deriveVaultKey(vaultKey: string, salt: Buffer): Buffer {
  return scryptSync(vaultKey, salt, 32);
}

async function readVault(
  filePath: string,
  vaultKey: string,
): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  const payload = JSON.parse(raw) as VaultFilePayload;
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const key = deriveVaultKey(vaultKey, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as Record<string, string>;
}

async function writeVault(
  filePath: string,
  vaultKey: string,
  entries: Record<string, string>,
): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveVaultKey(vaultKey, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(entries), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload: VaultFilePayload = {
    version: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('base64'),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export class VaultKeyMissingError extends Error {
  constructor() {
    super(
      'SHIPWRIGHT_NO_KEYCHAIN is set but SHIPWRIGHT_VAULT_KEY is not — the encrypted-file ' +
        'vault needs a key (interactive prompting is a CLI-layer concern, not this package)',
    );
    this.name = 'VaultKeyMissingError';
  }
}

/** Encrypted-file vault (node:crypto AES-256-GCM) — the headless/WSL fallback (P-003). */
export function createEncryptedFileCredentialStore(
  env: NodeJS.ProcessEnv = process.env,
): CredentialStore {
  const vaultKey = env.SHIPWRIGHT_VAULT_KEY;
  if (!vaultKey) throw new VaultKeyMissingError();
  const filePath = path.join(computeShipwrightHome(env), VAULT_FILENAME);
  return {
    async get(ref) {
      const entries = await readVault(filePath, vaultKey);
      return entries[ref];
    },
    async set(ref, value) {
      const entries = await readVault(filePath, vaultKey);
      entries[ref] = value;
      await writeVault(filePath, vaultKey, entries);
    },
    async delete(ref) {
      const entries = await readVault(filePath, vaultKey);
      delete entries[ref];
      await writeVault(filePath, vaultKey, entries);
    },
  };
}

export class NoKeychainAdapterError extends Error {
  constructor(platform: string) {
    super(
      `no OS keychain adapter for platform "${platform}" yet — set SHIPWRIGHT_NO_KEYCHAIN=1 ` +
        'and SHIPWRIGHT_VAULT_KEY to use the encrypted-file credential store instead',
    );
    this.name = 'NoKeychainAdapterError';
  }
}

/** Picks the credential store backend per SHIPWRIGHT_NO_KEYCHAIN / platform (P-003). */
export function resolveCredentialStore(
  env: NodeJS.ProcessEnv = process.env,
): CredentialStore {
  if (env.SHIPWRIGHT_NO_KEYCHAIN) return createEncryptedFileCredentialStore(env);
  if (process.platform === 'darwin') return createMacKeychainCredentialStore();
  throw new NoKeychainAdapterError(process.platform);
}
