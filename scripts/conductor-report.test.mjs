// conductor-report.test.mjs — P0-03 fixture suite for the honest-denominator
// report. The fixture reproduces the exact shape that fooled the first
// analysis: many block EVENTS on tickets that later completed. Law L5.

import { describe, it, expect } from 'vitest';
import { aggregate, render } from './conductor-report.mjs';

const row = (kind, ticket, msg = '', ts = '2026-08-31T00:00:00Z') => ({ ts, kind, ticket, msg });

// 4 unique tickets: A done clean; B blocked twice then done (recovered);
// C blocked and stays blocked; D started, still running. Plus 2 retries on B,
// 3 gates.fail events, 1 infra block, 2 fatals of one bug + 1 of another.
const FIXTURE = [
  row('conductor.start', undefined),
  row('ticket.start', 'W1-A'), row('ticket.done', 'W1-A'),
  row('ticket.start', 'W1-B'), row('gates.fail', 'W1-B'), row('ticket.retry', 'W1-B'),
  row('gates.fail', 'W1-B'), row('ticket.blocked', 'W1-B'),
  row('ticket.start', 'W1-B'), row('ticket.retry', 'W1-B'), row('ticket.blocked', 'W1-B'),
  row('ticket.start', 'W1-B'), row('ticket.done', 'W1-B'),
  row('ticket.start', 'W2-C'), row('gates.fail', 'W2-C'), row('ticket.blocked', 'W2-C'),
  row('ticket.start', 'W2-D'),
  row('ticket.infra', 'W2-C', 'blocked_on_infrastructure: ENOSPC'),
  row('conductor.fatal', undefined, 'row.notes.push is not a function'),
  row('conductor.fatal', undefined, 'row.notes.push is not a function'),
  row('conductor.fatal', undefined, 'spawnSync git ENOBUFS'),
  row('review.result', 'W1-A'), row('review.result', 'W1-B'),
];

describe('aggregate (P0-03, Law L5)', () => {
  const a = aggregate(FIXTURE);

  it('counts UNIQUE tickets, not events — the denominator that fooled the first analysis', () => {
    expect(a.uniqueTickets.started).toBe(4);      // 6 start EVENTS, 4 tickets
    expect(a.uniqueTickets.done).toBe(2);          // A, B
    expect(a.uniqueTickets.everBlocked).toBe(2);   // B, C — 3 blocked EVENTS
    expect(a.uniqueTickets.recoveredAfterBlock).toBe(1); // B came back
    expect(a.uniqueTickets.stillBlocked).toBe(1);  // C
    expect(a.uniqueTickets.completionRate).toBe(50.0);
  });

  it('keeps event ratios as labeled cost indicators, separate from outcomes', () => {
    expect(a.perStartEvent.starts).toBe(6);
    expect(a.perStartEvent.retries).toBe(+(2 / 6).toFixed(2));
    expect(a.perStartEvent.gateFailures).toBe(+(3 / 6).toFixed(2));
  });

  it('names the window and waves so a partial log cannot pose as the board', () => {
    expect(a.window.waves).toEqual(['W1', 'W2']);
  });

  it('histograms fatals so one repeated bug reads as one bug, not a failure class', () => {
    expect(a.fatals['row.notes.push is not a function']).toBe(2);
    expect(a.fatals['spawnSync git ENOBUFS']).toBe(1);
  });

  it('counts infra blocks charged to nobody', () => {
    expect(a.infraBlocks).toBe(1);
  });

  it('render leads with unique-ticket outcomes and labels event ratios gameable', () => {
    const out = render(a);
    expect(out.indexOf('unique tickets')).toBeLessThan(out.indexOf('per start event'));
    expect(out).toContain('gameable');
    expect(out).toContain('THIS window only');
  });
});
