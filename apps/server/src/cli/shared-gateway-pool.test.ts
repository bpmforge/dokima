/**
 * W23-06. The pool is only worth having if two DIFFERENT roles, holding two
 * SEPARATELY CONSTRUCTED providers, still share one endpoint's limit — that is
 * the shape the old code got wrong, and every test here is about it.
 */

import { describe, expect, it } from 'vitest';
import type { Provider } from '@dokima/gateway';
import {
  endpointIdFor,
  pooledProvider,
  sharedGatewayPool,
} from './shared-gateway-pool.js';

/** A provider whose chat blocks until the test releases it, so overlap is observable rather than timed. */
function gatedProvider(id: string): {
  provider: Provider;
  release: () => void;
  active: () => number;
  started: () => number;
} {
  let activeCount = 0;
  let startedCount = 0;
  const waiters: (() => void)[] = [];
  const provider = {
    id,
    chat: async () => {
      startedCount += 1;
      activeCount += 1;
      await new Promise<void>((resolve) => waiters.push(resolve));
      activeCount -= 1;
      return { message: { role: 'assistant' as const, content: 'ok' }, usage: undefined };
    },
    listModels: async () => [],
    getContextLength: async () => 4096,
    health: async () => ({ ok: true }),
    warmUp: async () => undefined,
    queueStats: () => ({ active: 0, queued: 0 }),
  } as unknown as Provider;
  return {
    provider,
    release: () => {
      for (const resolve of waiters.splice(0)) resolve();
    },
    active: () => activeCount,
    started: () => startedCount,
  };
}

const request = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('endpoint identity: two spellings of one server are one endpoint', () => {
  it.each([
    ['a trailing slash', 'http://localhost:1234/v1/', 'http://localhost:1234/v1'],
    ['host case', 'http://LOCALHOST:1234/v1', 'http://localhost:1234/v1'],
    [
      'a doubled trailing slash',
      'http://localhost:1234/v1//',
      'http://localhost:1234/v1',
    ],
  ])('%s does not create a second limit', (_name, a, b) => {
    expect(endpointIdFor({ providerId: 'lm-studio', baseUrl: a })).toBe(
      endpointIdFor({ providerId: 'lm-studio', baseUrl: b }),
    );
  });

  it('two genuinely different endpoints stay different, and so do two provider kinds on one host', () => {
    expect(
      endpointIdFor({ providerId: 'lm-studio', baseUrl: 'http://localhost:1234' }),
    ).not.toBe(
      endpointIdFor({ providerId: 'lm-studio', baseUrl: 'http://localhost:5678' }),
    );
    // Different auth, different models, different rate limits — merging them
    // would throttle one because the other is busy.
    expect(
      endpointIdFor({ providerId: 'ollama', baseUrl: 'http://localhost:1234' }),
    ).not.toBe(
      endpointIdFor({ providerId: 'lm-studio', baseUrl: 'http://localhost:1234' }),
    );
  });

  it('RED FIXTURE: credentials and query tokens never reach the key', () => {
    const id = endpointIdFor({
      providerId: 'oai-compat',
      baseUrl: 'https://user:hunter2@api.example.com/v1?api_key=abcdef0123456789',
    });
    expect(id).not.toContain('hunter2');
    expect(id).not.toContain('abcdef0123456789');
    expect(id).toBe('oai-compat:https://api.example.com/v1');
  });

  it('an unparseable base URL still normalizes rather than throwing', () => {
    expect(endpointIdFor({ providerId: 'x', baseUrl: 'not a url/' })).toBe('x:not a url');
    expect(endpointIdFor({})).toBe('unknown:');
  });
});

describe('one endpoint, one active request — across separately constructed providers', () => {
  it('RED FIXTURE: a maker-shaped and a reviewer-shaped provider on one endpoint do not overlap', async () => {
    const endpoint = endpointIdFor({
      providerId: 'lm-studio',
      baseUrl: 'http://localhost:9991',
    });
    const maker = gatedProvider('maker');
    const reviewer = gatedProvider('reviewer');

    // Two providers, constructed independently, exactly as run-build-spawn and
    // review-pass construct theirs.
    const pooledMaker = pooledProvider(maker.provider, endpoint, 'proj-1');
    const pooledReviewer = pooledProvider(reviewer.provider, endpoint, 'proj-1');

    const first = pooledMaker.chat(request);
    const second = pooledReviewer.chat(request);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(maker.started()).toBe(1);
    expect(reviewer.started()).toBe(0);
    expect(sharedGatewayPool().activeCount(endpoint)).toBe(1);

    maker.release();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reviewer.started()).toBe(1);

    reviewer.release();
    await second;
    expect(sharedGatewayPool().activeCount(endpoint)).toBe(0);
  });

  it('two DIFFERENT endpoints overlap freely', async () => {
    const a = gatedProvider('a');
    const b = gatedProvider('b');
    const first = pooledProvider(
      a.provider,
      endpointIdFor({ providerId: 'lm-studio', baseUrl: 'http://localhost:9992' }),
      'proj-1',
    ).chat(request);
    const second = pooledProvider(
      b.provider,
      endpointIdFor({ providerId: 'lm-studio', baseUrl: 'http://localhost:9993' }),
      'proj-1',
    ).chat(request);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(a.started()).toBe(1);
    expect(b.started()).toBe(1);
    a.release();
    b.release();
    await Promise.all([first, second]);
  });

  it('RED FIXTURE: a failing request releases its slot — a rejection cannot wedge the endpoint', async () => {
    const endpoint = endpointIdFor({
      providerId: 'lm-studio',
      baseUrl: 'http://localhost:9994',
    });
    const exploding = {
      id: 'boom',
      chat: async () => {
        throw new Error('provider exploded');
      },
    } as unknown as Provider;

    await expect(
      pooledProvider(exploding, endpoint, 'proj-1').chat(request),
    ).rejects.toThrow('provider exploded');
    expect(sharedGatewayPool().activeCount(endpoint)).toBe(0);

    // And the endpoint still works afterwards, which is the part that matters:
    // a leaked active count is invisible until the next request never starts.
    const after = gatedProvider('after');
    const pending = pooledProvider(after.provider, endpoint, 'proj-1').chat(request);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(after.started()).toBe(1);
    after.release();
    await pending;
  });
});

describe('the pool is imported, never constructed', () => {
  it('every caller gets the same instance', () => {
    expect(sharedGatewayPool()).toBe(sharedGatewayPool());
  });

  it('only chat is queued — a health probe from inside a queued chat cannot deadlock', async () => {
    const endpoint = endpointIdFor({
      providerId: 'lm-studio',
      baseUrl: 'http://localhost:9995',
    });
    const gated = gatedProvider('probe');
    const pooled = pooledProvider(gated.provider, endpoint, 'proj-1');

    const pending = pooled.chat(request);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sharedGatewayPool().activeCount(endpoint)).toBe(1);

    // A scheduler is not reentrant. If this were queued too it would wait for
    // the slot the chat above is holding, forever.
    await expect(pooled.health()).resolves.toEqual({ ok: true });

    gated.release();
    await pending;
  });
});
