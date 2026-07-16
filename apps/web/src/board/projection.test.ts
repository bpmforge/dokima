import { describe, expect, it } from 'vitest';
import type { ServerEnvelope } from '../lib/ws-client.js';
import {
  applyBoardEnvelope,
  applyHeartbeatEnvelope,
  boardSubscription,
  runSubscription,
} from './projection.js';
import { makeBoardTicket } from './test-helpers.js';

describe('applyBoardEnvelope', () => {
  it('upserts the ticket row from a ticket.* projection delta (board freshness, FR-C4)', () => {
    const before = new Map([
      ['W4-01', makeBoardTicket({ id: 'W4-01', status: 'in_progress' })],
    ]);
    const envelope: ServerEnvelope = {
      sub: 'board:PROJ1',
      seq: 3,
      type: 'ticket.closed',
      at: '2026-07-15T00:00:00Z',
      data: makeBoardTicket({ id: 'W4-01', status: 'in_review' }),
    };
    const after = applyBoardEnvelope(before, envelope);
    expect(after.get('W4-01')?.status).toBe('in_review');
  });

  it('inserts a new ticket id it has not seen before', () => {
    const after = applyBoardEnvelope(new Map(), {
      sub: 'board:PROJ1',
      seq: 1,
      type: 'ticket.created',
      at: '2026-07-15T00:00:00Z',
      data: makeBoardTicket({ id: 'W4-09' }),
    });
    expect(after.get('W4-09')).toBeDefined();
  });

  it('ignores envelopes that are not ticket projection deltas', () => {
    const before = new Map([['W4-01', makeBoardTicket({ id: 'W4-01' })]]);
    const after = applyBoardEnvelope(before, {
      sub: 'run:R42',
      seq: 1,
      type: 'loop.heartbeat',
      at: '2026-07-15T00:00:00Z',
      data: { ticket: 'W4-01', pass: '1/2', age_s: 5 },
    });
    expect(after).toBe(before);
  });

  it('ignores a malformed ticket.* payload rather than crashing the reducer', () => {
    const before = new Map();
    const after = applyBoardEnvelope(before, {
      sub: 'board:PROJ1',
      seq: 1,
      type: 'ticket.created',
      at: '2026-07-15T00:00:00Z',
      data: 'not a ticket',
    });
    expect(after).toBe(before);
  });
});

describe('applyHeartbeatEnvelope', () => {
  it('keys the heartbeat by the ticket it belongs to', () => {
    const after = applyHeartbeatEnvelope(new Map(), {
      sub: 'run:R42',
      seq: 1,
      type: 'loop.heartbeat',
      at: '2026-07-15T00:00:00Z',
      data: { ticket: 'W2-04', pass: '2/3', age_s: 12 },
    });
    expect(after.get('W2-04')).toEqual({ ticket: 'W2-04', pass: '2/3', age_s: 12 });
  });

  it('ignores non-heartbeat envelopes', () => {
    const before = new Map();
    const after = applyHeartbeatEnvelope(before, {
      sub: 'board:PROJ1',
      seq: 1,
      type: 'ticket.closed',
      at: '2026-07-15T00:00:00Z',
      data: makeBoardTicket({ id: 'W4-01' }),
    });
    expect(after).toBe(before);
  });
});

describe('subscription topic names', () => {
  it('matches the API_DESIGN §3 examples', () => {
    expect(boardSubscription('PROJ1')).toBe('board:PROJ1');
    expect(runSubscription('R42')).toBe('run:R42');
  });
});
