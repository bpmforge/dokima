import { describe, expect, it } from 'vitest';
import { validateProviderRegistry } from './validate.js';


/**
 * W10-57 second half. Commit 33cfb21 raised the LOCAL default 60s -> 300s and
 * left the cloud kinds at 60s, which acceptance 4 permits. What it did not do
 * is the rest of that sentence — "and make it configurable per provider
 * registry entry, so a slow local box and a fast hosted endpoint are not
 * forced to share one number". `requestTimeoutMs` existed on the provider
 * CONFIG and on no registry entry, so there was no way to set it.
 */
describe('per-entry request timeout (W10-57)', () => {
  const base = { id: 'local', kind: 'oai-compat' as const, baseUrl: 'http://127.0.0.1:1234/v1', enabled: true };

  it('RED FIXTURE: a positive integer timeout is accepted and survives validation', () => {
    const [entry] = validateProviderRegistry([{ ...base, requestTimeoutMs: 600_000 }]);
    expect(entry?.requestTimeoutMs).toBe(600_000);
  });

  it('an entry that sets no timeout keeps the kind default — absent, not zero', () => {
    const [entry] = validateProviderRegistry([base]);
    expect(entry?.requestTimeoutMs).toBeUndefined();
  });

  it.each([0, -1, 1.5, '30s', null])(
    'refuses %p — a timeout that never fires is not a timeout',
    (bad) => {
      expect(() =>
        validateProviderRegistry([{ ...base, requestTimeoutMs: bad as never }]),
      ).toThrow(/requestTimeoutMs/);
    },
  );
});
