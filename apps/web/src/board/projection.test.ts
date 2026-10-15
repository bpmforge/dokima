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
    }, 5_000);
    expect(after.get('W2-04')).toEqual({
      ticket: 'W2-04',
      pass: '2/3',
      age_s: 12,
      receivedAtMs: 5_000,
    });
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

describe('heartbeat lifecycle envelopes (review R1)', () => {
  const env = (type: string, data: unknown): ServerEnvelope => ({
    sub: 'run:run-1',
    seq: 1,
    type,
    at: '2026-10-15T00:00:00Z',
    data,
  });
  const beat = (ticket: string, run = 'run-1') =>
    env('loop.heartbeat', { ticket, run, phase: 'working', age_s: 0 });

  it('drops one ticket on loop.heartbeat_ended', () => {
    let hbs = applyHeartbeatEnvelope(new Map(), beat('T-1'), 1);
    hbs = applyHeartbeatEnvelope(hbs, beat('T-2'), 1);
    hbs = applyHeartbeatEnvelope(hbs, env('loop.heartbeat_ended', { ticket: 'T-1', run: 'run-1' }));
    expect([...hbs.keys()]).toEqual(['T-2']);
  });

  it('drops every ticket of the run on loop.run_ended, and keeps another run\'s', () => {
    let hbs = applyHeartbeatEnvelope(new Map(), beat('T-1'), 1);
    hbs = applyHeartbeatEnvelope(hbs, beat('T-2', 'run-2'), 1);
    hbs = applyHeartbeatEnvelope(hbs, env('loop.run_ended', { run: 'run-1' }));
    expect([...hbs.keys()]).toEqual(['T-2']);
  });

  it('returns the same map when an end names nothing it holds', () => {
    const hbs = applyHeartbeatEnvelope(new Map(), beat('T-1'), 1);
    expect(applyHeartbeatEnvelope(hbs, env('loop.heartbeat_ended', { ticket: 'T-9' }))).toBe(hbs);
    expect(applyHeartbeatEnvelope(hbs, env('loop.run_ended', { run: 'run-9' }))).toBe(hbs);
  });
});
