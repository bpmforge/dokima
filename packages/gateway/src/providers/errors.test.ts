import { describe, expect, it } from 'vitest';
import { ProviderUnreachableError } from './errors.js';


/**
 * Found 2026-08-28 driving a real local run: a resume failed with
 * "lm-studio: endpoint unreachable — TypeError: fetch failed" while LM Studio
 * was up and serving, and the product told the user to start their provider.
 * `String(cause)` on a failed fetch flattens away the only part that says what
 * actually happened, so nothing-listening and a client-side deadline read
 * identically.
 */
describe('ProviderUnreachableError names WHY, not just that it failed', () => {
  it('RED FIXTURE: carries the nested cause and its code', () => {
    const inner = Object.assign(new Error('Headers Timeout Error'), {
      name: 'HeadersTimeoutError',
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    const outer = Object.assign(new TypeError('fetch failed'), { cause: inner });

    const err = new ProviderUnreachableError('lm-studio', outer);

    expect(err.message).toContain('UND_ERR_HEADERS_TIMEOUT');
    expect(err.message).toContain('lm-studio: endpoint unreachable');
  });

  it('distinguishes nothing-listening from a dropped socket', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    expect(new ProviderUnreachableError('ollama', refused).message).toContain('ECONNREFUSED');
  });

  it('a cause with no code still reads sensibly', () => {
    const err = new ProviderUnreachableError('x', new Error('boom'));
    expect(err.message).toContain('boom');
  });

  it('a non-Error cause falls back to its string form', () => {
    expect(new ProviderUnreachableError('x', 'plain string').message).toContain('plain string');
  });
});
