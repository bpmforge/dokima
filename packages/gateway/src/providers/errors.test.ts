import { describe, expect, it } from 'vitest';
import { ProviderTimeoutError, ProviderUnreachableError } from './errors.js';


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

describe('a timeout names the model that ran long (W22-07)', () => {
  it('RED FIXTURE: the message names the model, not only the provider', () => {
    // Measured live 2026-08-28: "lm-studio: request timed out after 300000ms".
    // C-4 guarantees the user has a maker AND a distinct reviewer configured,
    // so naming only the host tells them to pick a faster model without
    // saying which of their two was slow.
    const err = new ProviderTimeoutError('lm-studio', 300_000, 'qwen3.8-flash-next');
    expect(err.message).toContain('qwen3.8-flash-next');
    expect(err.message).toContain('lm-studio');
    expect(err.message).toContain('300000ms');
  });

  it('degrades to the old message when the caller cannot know the model', () => {
    // The request-queue wait has no model by construction. Inventing one there
    // would be worse than omitting it.
    const err = new ProviderTimeoutError('lm-studio', 300_000);
    expect(err.message).toBe('lm-studio: request timed out after 300000ms');
    expect(err.model).toBeUndefined();
  });

  it('keeps the provider and the ceiling readable as fields, not only as prose', () => {
    const err = new ProviderTimeoutError('ollama', 1_200_000, 'llama3.3');
    expect(err.providerId).toBe('ollama');
    expect(err.timeoutMs).toBe(1_200_000);
    expect(err.model).toBe('llama3.3');
  });
});
