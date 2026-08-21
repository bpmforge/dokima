import { describe, expect, it } from 'vitest';
import { createLineDecoder, encodeFrame } from './framing.js';

describe('newline-delimited JSON-RPC framing (W14-01)', () => {
  it('round-trips a message through encode -> chunked decode', () => {
    const seen: unknown[] = [];
    const decoder = createLineDecoder({
      onMessage: (m) => seen.push(m),
      onGarbage: () => {},
    });
    const frame = encodeFrame({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    // Split mid-JSON: stdio gives no whole-frame guarantee.
    decoder.feed(frame.slice(0, 10));
    decoder.feed(frame.slice(10));
    expect(seen).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  });

  it('handles several messages in one chunk and keeps the partial tail', () => {
    const seen: { id: unknown }[] = [];
    const decoder = createLineDecoder({
      onMessage: (m) => seen.push(m as { id: unknown }),
      onGarbage: () => {},
    });
    decoder.feed('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","id":2}\n{"jsonrpc":"2.0",');
    expect(seen.map((m) => m.id)).toEqual([1, 2]);
    decoder.feed('"id":3}\n');
    expect(seen.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('surfaces a non-JSON line as garbage instead of dropping it silently', () => {
    const garbage: string[] = [];
    const decoder = createLineDecoder({
      onMessage: () => {},
      onGarbage: (line) => garbage.push(line),
    });
    decoder.feed('starting fake server, please hold\n');
    expect(garbage).toEqual(['starting fake server, please hold']);
  });
});
