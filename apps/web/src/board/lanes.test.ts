import { describe, expect, it } from 'vitest';
import { groupIntoLanes } from './lanes.js';
import { makeBoardTicket } from './test-helpers.js';

describe('groupIntoLanes', () => {
  it('groups tickets into lanes (alphabetical) x the fixed six columns', () => {
    const tickets = [
      makeBoardTicket({ id: 'W2-01', lane: 'gateway', status: 'ready' }),
      makeBoardTicket({ id: 'W1-01', lane: 'content', status: 'done' }),
      makeBoardTicket({ id: 'W1-02', lane: 'content', status: 'ready' }),
    ];
    const lanes = groupIntoLanes(tickets);
    expect(lanes.map((l) => l.lane)).toEqual(['content', 'gateway']);
    const content = lanes[0]!;
    expect(content.columns.map((c) => c.status)).toEqual([
      'ready',
      'claimed',
      'in_progress',
      'in_review',
      'blocked',
      'done',
    ]);
    expect(
      content.columns.find((c) => c.status === 'ready')?.tickets.map((t) => t.id),
    ).toEqual(['W1-02']);
    expect(
      content.columns.find((c) => c.status === 'done')?.tickets.map((t) => t.id),
    ).toEqual(['W1-01']);
  });

  it('sorts tickets within a column by the board projection sortKey', () => {
    const tickets = [
      makeBoardTicket({ id: 'B', lane: 'ui', status: 'ready', sortKey: '2' }),
      makeBoardTicket({ id: 'A', lane: 'ui', status: 'ready', sortKey: '1' }),
    ];
    const [lane] = groupIntoLanes(tickets);
    const ready = lane!.columns.find((c) => c.status === 'ready')!;
    expect(ready.tickets.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it("returns no lanes for an empty board (empty state is the caller's concern)", () => {
    expect(groupIntoLanes([])).toEqual([]);
  });
});
