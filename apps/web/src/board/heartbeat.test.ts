import { describe, expect, it } from 'vitest';
import { activeBerths, formatHeartbeat, heartbeatFreshness } from './heartbeat.js';

describe('heartbeatFreshness', () => {
  it('is fresh under the 2-missed-beat threshold (30s, API_DESIGN 15s cadence)', () => {
    expect(heartbeatFreshness(12)).toBe('fresh');
    expect(heartbeatFreshness(29)).toBe('fresh');
  });

  it('turns amber at or past 30s — the same point the transport itself would give up', () => {
    expect(heartbeatFreshness(30)).toBe('amber');
    expect(heartbeatFreshness(90)).toBe('amber');
  });
});

describe('formatHeartbeat', () => {
  it('renders "pass N/M · Ns ago" (UX_SPEC §4 card contents)', () => {
    expect(formatHeartbeat({ ticket: 'W2-04', pass: '2/3', age_s: 40 })).toBe(
      'pass 2/3 · 40s ago',
    );
  });
});

describe('activeBerths', () => {
  it('derives one entry per ticket with a live heartbeat, sorted by ticket id', () => {
    const heartbeats = new Map([
      ['W3-02', { ticket: 'W3-02', pass: '1/2', age_s: 5 }],
      ['W2-04', { ticket: 'W2-04', pass: '2/3', age_s: 40 }],
    ]);
    const berths = activeBerths(heartbeats);
    expect(berths.map((b) => b.ticketId)).toEqual(['W2-04', 'W3-02']);
    expect(berths.find((b) => b.ticketId === 'W2-04')?.freshness).toBe('amber');
    expect(berths.find((b) => b.ticketId === 'W3-02')?.freshness).toBe('fresh');
  });

  it('is empty when no berth is active', () => {
    expect(activeBerths(new Map())).toEqual([]);
  });
});
