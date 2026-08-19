/**
 * W12-43. The dangerous case is not "no key" — it is "no key, on a project
 * that already has receipts", where a replacement invalidates history without
 * failing loudly.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '@dokima/shared';
import {
  resolveSigningKey,
  SIGNING_KEY_REF,
  SigningKeyMissingError,
  SigningKeyUnreadableError,
} from './signing-key.js';

function store(initial: Record<string, string> = {}): CredentialStore & {
  entries: Record<string, string>;
} {
  const entries = { ...initial };
  return {
    entries,
    get: vi.fn(async (ref: string) => entries[ref]),
    set: vi.fn(async (ref: string, value: string) => {
      entries[ref] = value;
    }),
    delete: vi.fn(async (ref: string) => {
      delete entries[ref];
    }),
  };
}

const NO_ENV: NodeJS.ProcessEnv = {};

describe('resolveSigningKey (W12-43)', () => {
  it(
    'RED FIXTURE: a fresh install MINTS instead of refusing. The key is an ' +
      'HMAC secret with no public half, so nobody can supply a better one than ' +
      'randomBytes — asking was a worse experience than the env var it replaced',
    async () => {
      const s = store();
      const result = await resolveSigningKey({ receiptCount: 0, env: NO_ENV, store: s });
      expect(result.source).toBe('minted');
      expect(result.key).toMatch(/^[0-9a-f]{64}$/);
      expect(s.entries[SIGNING_KEY_REF]).toBe(result.key);
    },
  );

  it('and never mints twice — the second run reads the first run’s key', async () => {
    const s = store();
    const first = await resolveSigningKey({ receiptCount: 0, env: NO_ENV, store: s });
    const second = await resolveSigningKey({ receiptCount: 9, env: NO_ENV, store: s });
    expect(second.key).toBe(first.key);
    expect(second.source).toBe('keychain');
  });

  it(
    'RED FIXTURE: a project WITH receipts and no key is REFUSED, not re-keyed. ' +
      'A second key does not fail loudly; it makes every existing receipt fail ' +
      'its MAC, so the project silently reports itself unverifiable',
    async () => {
      const s = store();
      await expect(
        resolveSigningKey({ receiptCount: 3, env: NO_ENV, store: s }),
      ).rejects.toBeInstanceOf(SigningKeyMissingError);
      // The critical assertion: nothing was written on the way out.
      expect(s.set).not.toHaveBeenCalled();
      expect(s.entries[SIGNING_KEY_REF]).toBeUndefined();
    },
  );

  it(
    'an UNREADABLE store is refused too, and named differently. Treating a ' +
      'vault that failed to open as "no key yet" would mint over a key that ' +
      'still exists — the same loss by a quieter route',
    async () => {
      const broken: CredentialStore = {
        get: async () => {
          throw new Error('Unsupported state or unable to authenticate data');
        },
        set: vi.fn(),
        delete: vi.fn(),
      };
      await expect(
        resolveSigningKey({ receiptCount: 0, env: NO_ENV, store: broken }),
      ).rejects.toBeInstanceOf(SigningKeyUnreadableError);
      expect(broken.set).not.toHaveBeenCalled();
    },
  );

  it('the env var still wins, and is read before the store is touched (the CI seam)', async () => {
    const s = store({ [SIGNING_KEY_REF]: 'from-keychain' });
    const result = await resolveSigningKey({
      receiptCount: 5,
      env: { DOKIMA_SIGNING_KEY: 'from-env' },
      store: s,
    });
    expect(result).toEqual({ key: 'from-env', source: 'env' });
    // Not consulted at all: an automated run must never trigger a keychain prompt.
    expect(s.get).not.toHaveBeenCalled();
  });
});
