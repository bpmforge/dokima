import { describe, expect, it } from 'vitest';
import { validateProviderEntry, validateProviderRegistry } from './validate.js';


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

describe('project-scoped kinds (W12-14)', () => {
  const base = { id: 'v1', kind: 'vertex' as const, enabled: true };

  it(
    'RED FIXTURE: a vertex entry REQUIRES project and location by name. Neither is ' +
      'derivable from anything else on the entry, and a default would be a guess ' +
      'about which cloud account gets billed',
    () => {
      expect(() => validateProviderEntry({ ...base, location: 'us-central1' })).toThrowError(
        /requires project/,
      );
      expect(() => validateProviderEntry({ ...base, project: 'my-gcp-project' })).toThrowError(
        /requires location/,
      );
    },
  );

  it(
    'RED FIXTURE (settable-and-inert): the accepted fields SURVIVE onto the entry. ' +
      "validate.ts's construction is an allowlist — a field validated above and " +
      'omitted there is silently dropped, which is exactly the defect W10-57 ' +
      'documented in this same function',
    () => {
      const entry = validateProviderEntry({
        ...base,
        project: 'my-gcp-project',
        location: 'us-central1',
      });
      expect(entry.project).toBe('my-gcp-project');
      expect(entry.location).toBe('us-central1');
    },
  );

  it('a non-project kind is unaffected — the requirement is per-kind, not global', () => {
    const entry = validateProviderEntry({ id: 'oa', kind: 'openai', enabled: true });
    expect(entry.project).toBeUndefined();
    expect(entry.location).toBeUndefined();
  });

  it('rejects a non-string project or location rather than coercing it', () => {
    expect(() =>
      validateProviderEntry({ ...base, project: 42, location: 'us-central1' }),
    ).toThrowError(/project must be a string|requires project/);
  });
});

describe('requestExtras on a provider entry (W13-10)', () => {
  const base = { id: 'studio', kind: 'oai-compat', baseUrl: 'http://x.invalid/v1', enabled: true };

  it('survives validation and reaches the entry — a field the adapter never sees is settable and inert', () => {
    const entry = validateProviderEntry({ ...base, requestExtras: { reasoning_effort: 'none' } });
    expect(entry.requestExtras).toEqual({ reasoning_effort: 'none' });
  });

  it('refuses a non-object rather than silently dropping it', () => {
    for (const bad of ['none', 42, ['a'], null]) {
      expect(() => validateProviderEntry({ ...base, requestExtras: bad })).toThrow(
        /requestExtras must be a JSON object/,
      );
    }
  });

  it('stays absent when not set — 12 existing entries must be unchanged', () => {
    expect(validateProviderEntry(base).requestExtras).toBeUndefined();
  });
});
