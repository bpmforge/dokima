import { describe, expect, it } from 'vitest';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from '../providers/errors.js';
import { classifyProviderError } from './classify.js';

const NOON = new Date('2026-07-12T12:00:00.000Z').getTime();

describe('FR-G8: classifyProviderError — limit vs terminal', () => {
  it('classifies ProviderRateLimitError as limit, deriving resumeAt from retryAfterMs when no stated reset time is present', () => {
    const err = new ProviderRateLimitError(
      'anthropic',
      429,
      'Too Many Requests',
      'rate limited',
      30_000,
    );
    const result = classifyProviderError(err, NOON);
    expect(result.class).toBe('limit');
    expect(result.resumeAt).toBe(new Date(NOON + 30_000).toISOString());
  });

  it('classifies ProviderRateLimitError and prefers a stated reset time over retryAfterMs', () => {
    const err = new ProviderRateLimitError(
      'anthropic',
      429,
      'Too Many Requests',
      'usage limit reached, resets 10:10pm',
      30_000,
    );
    const result = classifyProviderError(err, NOON);
    expect(result.class).toBe('limit');
    const expected = new Date(NOON);
    expected.setHours(22, 10, 0, 0);
    expect(result.resumeAt).toBe(new Date(expected.getTime() + 2 * 60_000).toISOString());
  });

  it('classifies a 429 ProviderHttpError as limit even without a typed ProviderRateLimitError', () => {
    const err = new ProviderHttpError(
      'openai',
      429,
      'Too Many Requests',
      'quota exceeded',
    );
    expect(classifyProviderError(err, NOON).class).toBe('limit');
  });

  it('classifies a 529 (overloaded) ProviderHttpError as limit', () => {
    const err = new ProviderHttpError(
      'anthropic',
      529,
      'Overloaded',
      'the server is overloaded',
    );
    expect(classifyProviderError(err, NOON).class).toBe('limit');
  });

  it('classifies a ProviderHttpError with a quota/limit message but non-limit status as limit', () => {
    const err = new ProviderHttpError(
      'vertex',
      400,
      'Bad Request',
      'session limit reached for this account',
    );
    expect(classifyProviderError(err, NOON).class).toBe('limit');
  });

  it('classifies an unrelated ProviderHttpError as terminal', () => {
    const err = new ProviderHttpError(
      'openai',
      400,
      'Bad Request',
      'invalid request body',
    );
    expect(classifyProviderError(err, NOON)).toEqual({ class: 'terminal' });
  });

  it('classifies ProviderAuthError as terminal (waiting never fixes bad credentials)', () => {
    const err = new ProviderAuthError('copilot', 401, 'Unauthorized', 'invalid token');
    expect(classifyProviderError(err, NOON)).toEqual({ class: 'terminal' });
  });

  it('classifies ProviderResponseShapeError as terminal', () => {
    const err = new ProviderResponseShapeError('openai', 'missing usage field');
    expect(classifyProviderError(err, NOON)).toEqual({ class: 'terminal' });
  });

  it('classifies ProviderTimeoutError as terminal (not a provider-stated limit)', () => {
    const err = new ProviderTimeoutError('vertex', 30_000);
    expect(classifyProviderError(err, NOON)).toEqual({ class: 'terminal' });
  });

  it('classifies ProviderUnreachableError as terminal', () => {
    const err = new ProviderUnreachableError('openai', new Error('ECONNREFUSED'));
    expect(classifyProviderError(err, NOON)).toEqual({ class: 'terminal' });
  });

  it('classifies raw provider/CLI output text (no typed error) by the same rules', () => {
    const result = classifyProviderError(
      'Error: usage limit reached, resets 10:10pm',
      NOON,
    );
    expect(result.class).toBe('limit');
    expect(result.resumeAt).toBeDefined();
  });

  it('classifies unrelated raw text as terminal', () => {
    expect(classifyProviderError('permission denied', NOON)).toEqual({
      class: 'terminal',
    });
  });

  it('classifies a plain Error whose message mentions rate limiting as limit', () => {
    expect(classifyProviderError(new Error('rate-limited, try later'), NOON).class).toBe(
      'limit',
    );
  });

  it('classifies an unknown thrown value as terminal', () => {
    expect(classifyProviderError({ not: 'an error' }, NOON)).toEqual({
      class: 'terminal',
    });
    expect(classifyProviderError(undefined, NOON)).toEqual({ class: 'terminal' });
  });
});
