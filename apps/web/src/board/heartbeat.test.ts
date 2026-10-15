import { describe, expect, it } from 'vitest';
import {
  activeBerths,
  formatHeartbeat,
  heartbeatFreshness,
  isHeartbeatStale,
} from './heartbeat.js';

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

describe('run producer heartbeats (review R1)', () => {
  const received = 1_000_000;
  const live = {
    ticket: 'T-1',
    run: 'run-1',
    phase: 'working',
    step: 'write_file',
    model: 'fake-model',
    rung: 'R1',
    age_s: 3,
    elapsed_s: 125,
    receivedAtMs: received,
  };

  it('says the phase, step, model, rung, elapsed time and last activity', () => {
    expect(formatHeartbeat(live, received)).toBe(
      'Working (write_file) · fake-model · rung R1 · 2m 5s in · last activity 3s ago',
    );
  });

  it('omits what the server did not send', () => {
    expect(
      formatHeartbeat(
        { ticket: 'T-1', phase: 'claiming', age_s: 0, receivedAtMs: received },
        received,
      ),
    ).toBe('Claiming the ticket · last activity 0s ago');
  });

  it('ticks ages forward locally and turns stale after 15s without a beat', () => {
    const later = received + 16_000;
    expect(isHeartbeatStale(live, received + 14_000)).toBe(false);
    expect(isHeartbeatStale(live, later)).toBe(true);
    expect(formatHeartbeat(live, later)).toBe(
      'Working (write_file) · fake-model · rung R1 · 2m 21s in · last activity 19s ago · no update for 16s',
    );
    const [berth] = activeBerths(new Map([['T-1', live]]), received + 40_000);
    expect(berth).toMatchObject({ stale: true, freshness: 'amber' });
  });

  it('is never stale when the arrival time is unknown', () => {
    expect(isHeartbeatStale({ ticket: 'T-1', age_s: 3 }, received)).toBe(false);
  });
});
