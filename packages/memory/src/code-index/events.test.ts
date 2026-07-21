import { describe, expect, it } from 'vitest';
import { createInMemoryCodeIndexEventSink, noopCodeIndexEventSink } from './events.js';

describe('noopCodeIndexEventSink', () => {
  it('accepts an event and does nothing observable', () => {
    expect(() =>
      noopCodeIndexEventSink.emit({
        type: 'code_index.code_search',
        occurredAt: '2026-07-20T12:00:00.000Z',
        detail: {},
      }),
    ).not.toThrow();
  });
});

describe('createInMemoryCodeIndexEventSink', () => {
  it('records every emitted event in order', () => {
    const sink = createInMemoryCodeIndexEventSink();
    sink.emit({
      type: 'code_index.indexed',
      occurredAt: '2026-07-20T12:00:00.000Z',
      detail: { filesIndexed: 3 },
    });
    sink.emit({
      type: 'code_index.code_search',
      occurredAt: '2026-07-20T12:00:01.000Z',
      detail: { query: 'frobnicate' },
    });
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]?.type).toBe('code_index.indexed');
    expect(sink.events[1]?.type).toBe('code_index.code_search');
  });
});
