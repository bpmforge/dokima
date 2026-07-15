import { describe, expect, it } from 'vitest';
import { parseServerEnvelope } from './ws-client.js';

describe('parseServerEnvelope', () => {
  it('parses a well-formed server envelope', () => {
    const raw = JSON.stringify({
      sub: 'board:PROJ1',
      seq: 3,
      type: 'ticket.closed',
      at: '2026-07-15T00:00:00Z',
      data: { id: 'W4-01' },
    });
    expect(parseServerEnvelope(raw)).toEqual({
      sub: 'board:PROJ1',
      seq: 3,
      type: 'ticket.closed',
      at: '2026-07-15T00:00:00Z',
      data: { id: 'W4-01' },
    });
  });

  it('returns null for malformed JSON', () => {
    expect(parseServerEnvelope('not json')).toBeNull();
  });

  it('returns null for JSON missing required envelope fields', () => {
    expect(parseServerEnvelope(JSON.stringify({ sub: 'board:PROJ1' }))).toBeNull();
    expect(parseServerEnvelope(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(parseServerEnvelope(JSON.stringify(null))).toBeNull();
  });
});
