import { describe, expect, it } from 'vitest';
import { extractIdempotencyKey, IdempotencyStore } from './idempotency.js';

describe('IdempotencyStore', () => {
  it('returns undefined for an unseen key', () => {
    const store = new IdempotencyStore();
    expect(store.get('missing')).toBeUndefined();
  });

  it('replays the exact stored response for a repeated key', () => {
    const store = new IdempotencyStore();
    const response = {
      status: 200,
      body: { id: 'T-1', status: 'claimed' },
      headers: { 'x-event-seq': '1' },
    };
    store.put('claim:T-1:k-1', response);
    expect(store.get('claim:T-1:k-1')).toEqual(response);
  });

  it('evicts the oldest entry once maxEntries is exceeded', () => {
    const store = new IdempotencyStore({ maxEntries: 2 });
    store.put('a', { status: 200, body: 1, headers: {} });
    store.put('b', { status: 200, body: 2, headers: {} });
    store.put('c', { status: 200, body: 3, headers: {} });
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toEqual({ status: 200, body: 2, headers: {} });
    expect(store.get('c')).toEqual({ status: 200, body: 3, headers: {} });
    expect(store.size).toBe(2);
  });

  it('re-storing an existing key does not evict another entry', () => {
    const store = new IdempotencyStore({ maxEntries: 2 });
    store.put('a', { status: 200, body: 1, headers: {} });
    store.put('b', { status: 200, body: 2, headers: {} });
    store.put('a', { status: 200, body: 'updated', headers: {} });
    expect(store.get('a')).toEqual({ status: 200, body: 'updated', headers: {} });
    expect(store.get('b')).toEqual({ status: 200, body: 2, headers: {} });
  });
});

describe('extractIdempotencyKey', () => {
  it('reads a single string header value', () => {
    expect(extractIdempotencyKey({ 'idempotency-key': 'k-1' })).toBe('k-1');
  });

  it('reads the first value of an array header', () => {
    expect(extractIdempotencyKey({ 'idempotency-key': ['k-1', 'k-2'] })).toBe('k-1');
  });

  it('returns undefined when absent or empty', () => {
    expect(extractIdempotencyKey({})).toBeUndefined();
    expect(extractIdempotencyKey({ 'idempotency-key': '' })).toBeUndefined();
  });
});
