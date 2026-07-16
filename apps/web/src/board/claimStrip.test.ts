import { describe, expect, it } from 'vitest';
import { claimNowEntries } from './claimStrip.js';
import { makeBoardTicket } from './test-helpers.js';

describe('claimNowEntries', () => {
  it('picks the smallest claimable ticket per lane', () => {
    const tickets = [
      makeBoardTicket({ id: 'W2-05', lane: 'gateway', sortKey: '2', claimable: true }),
      makeBoardTicket({ id: 'W2-01', lane: 'gateway', sortKey: '1', claimable: true }),
      makeBoardTicket({
        id: 'W3-01',
        lane: 'harbormaster',
        sortKey: '1',
        claimable: true,
      }),
    ];
    expect(claimNowEntries(tickets).map((t) => t.id)).toEqual(['W2-01', 'W3-01']);
  });

  it('ignores tickets that are not claimable (owned, deps unmet, WIP-blocked)', () => {
    const tickets = [makeBoardTicket({ id: 'W2-01', lane: 'gateway', claimable: false })];
    expect(claimNowEntries(tickets)).toEqual([]);
  });

  it('sorts the strip itself by lane name', () => {
    const tickets = [
      makeBoardTicket({ id: 'W3-01', lane: 'z-lane', claimable: true }),
      makeBoardTicket({ id: 'W2-01', lane: 'a-lane', claimable: true }),
    ];
    expect(claimNowEntries(tickets).map((t) => t.lane)).toEqual(['a-lane', 'z-lane']);
  });
});
