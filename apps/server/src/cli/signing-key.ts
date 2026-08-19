/**
 * signing-key.ts — the receipt signing key, resolved without asking (W12-43).
 *
 * W12-40 made a missing key an honest 409 instead of a silent 202, so the
 * failure stopped being invisible. It was still not FIXABLE from the product:
 * the refusal told a user to export an environment variable and restart the
 * core, which is the terminal step W12-20 existed to remove.
 *
 * WHY MINTING IS THE ANSWER, AND NOT A KEY-ENTRY FIELD. The key is an
 * HMAC-SHA256 secret (`receipts/mac.ts`): symmetric, local, with no public
 * half and nothing outside this machine that verifies against it. Nobody can
 * supply a *better* one than `randomBytes`, so a field asking a person who has
 * never heard of receipt signing to invent a secret would be worse than the
 * env var it replaced — it would look like a real choice while having exactly
 * one correct answer.
 *
 * WHY IT IS NEVER REGENERATED, which is the whole risk here. Receipts are
 * verified later: `verifyReceipt` drives phase staleness and gate decisions.
 * A second key does not fail loudly — it makes every previously minted receipt
 * fail its MAC, so a project silently reports itself unverifiable and every
 * completed phase looks stale. So a missing key on a project that HAS receipts
 * is refused by name rather than quietly replaced. Minting only ever happens
 * where there is nothing yet to invalidate.
 */
import { randomBytes } from 'node:crypto';
import { resolveCredentialStore, type CredentialStore } from '@dokima/shared';

/** One key per install, not per project: receipts already bind their own projectId in the MAC. */
export const SIGNING_KEY_REF = 'dokima.signing-key';

/** 32 bytes hex. HMAC-SHA256's block size; more is not stronger, less is worth arguing about. */
const KEY_BYTES = 32;

/** The vault exists but will not open — a different problem from a missing key. */
export class SigningKeyUnreadableError extends Error {
  constructor(cause: string) {
    super(
      `the credential store holding the signing key could not be read: ${cause}. ` +
        `This is NOT the same as "no key yet" and Dokima will not mint over it — ` +
        `a wrong DOKIMA_VAULT_KEY, or a keychain entry this user cannot unlock, ` +
        `must be fixed rather than replaced. Check DOKIMA_VAULT_KEY, or set ` +
        `DOKIMA_SIGNING_KEY for this run.`,
    );
    this.name = 'SigningKeyUnreadableError';
  }
}

export class SigningKeyMissingError extends Error {
  constructor(receiptCount: number) {
    super(
      `this project has ${receiptCount} signed receipt(s) but the signing key is ` +
        `gone from the keychain. Dokima will NOT mint a replacement: a new key ` +
        `does not fail loudly, it makes every existing receipt fail verification, ` +
        `so the project would quietly report itself unverifiable and every ` +
        `completed phase would look stale. Restore the key, or set ` +
        `DOKIMA_SIGNING_KEY to it for this run.`,
    );
    this.name = 'SigningKeyMissingError';
  }
}

export interface ResolveSigningKeyOptions {
  /** How many receipts this project already has — 0 means nothing to invalidate. */
  readonly receiptCount: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Tests inject; production resolves the platform store. */
  readonly store?: CredentialStore;
  readonly generate?: () => string;
}

export interface SigningKeyResolution {
  readonly key: string;
  /** `minted` only on the first run of a fresh install — worth saying out loud once. */
  readonly source: 'env' | 'keychain' | 'minted';
}

export async function resolveSigningKey(
  options: ResolveSigningKeyOptions,
): Promise<SigningKeyResolution> {
  // The env var still WINS, and keeps winning: it is the documented CI seam
  // (law 9a fixtures run with a fixed key) and the escape hatch the refusal
  // below points at. Reading it first also means a keychain prompt never
  // appears in an automated run.
  const fromEnv = (options.env ?? process.env).DOKIMA_SIGNING_KEY;
  if (fromEnv) return { key: fromEnv, source: 'env' };

  const store = options.store ?? resolveCredentialStore(options.env ?? process.env);

  // An unreadable store is NOT an absent key. Letting the read throw would
  // reach the caller as a raw crypto error ("Unsupported state or unable to
  // authenticate data"), and treating it as absent would be worse still —
  // minting over a vault that merely failed to open is how the existing key
  // gets orphaned and every receipt signed with it stops verifying.
  let existing: string | undefined;
  try {
    existing = await store.get(SIGNING_KEY_REF);
  } catch (err) {
    throw new SigningKeyUnreadableError(err instanceof Error ? err.message : String(err));
  }
  if (existing) return { key: existing, source: 'keychain' };

  if (options.receiptCount > 0) throw new SigningKeyMissingError(options.receiptCount);

  const minted = (options.generate ?? (() => randomBytes(KEY_BYTES).toString('hex')))();
  await store.set(SIGNING_KEY_REF, minted);
  return { key: minted, source: 'minted' };
}
