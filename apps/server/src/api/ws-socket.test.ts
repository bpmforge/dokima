import { describe, expect, it } from 'vitest';
import { computeAcceptKey } from './ws-socket.js';

describe('computeAcceptKey', () => {
  it('matches the RFC 6455 §1.3 worked example', () => {
    // The example straight from the spec: given this client key, this is the
    // one correct Sec-WebSocket-Accept value.
    expect(computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe(
      's3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
    );
  });
});
