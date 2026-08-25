/** W20-04: handoffs are read from events that already exist — never synthesised. */
import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../board/drawer/types.js';
import { deriveHandoffs, handoffLine } from './handoffs.js';

const ev = (over: Partial<TraceEvent> & { seq: number }): TraceEvent => ({
  event_type: 'ticket.claimed',
  actor_id: 'coding-agent',
  ticket_id: 'T-1',
  run_id: 'r1',
  payload: null,
  created_at: '2026-08-24T14:00:00.000Z',
  ...over,
});

const NAMES: Record<string, string> = {
  'coding-agent': 'Sam',
  challenger: 'Wiggum',
  'architecture-designer': 'Blue',
};
const nameOf = (a: string) => NAMES[a] ?? a;

describe('deriveHandoffs (W20-04)', () => {
  it('RED FIXTURE: a maker closing and the SAME actor commenting is not a handoff — a relay needs two people', () => {
    const solo = deriveHandoffs([
      ev({ seq: 1, event_type: 'ticket.closed' }),
      ev({ seq: 2, event_type: 'ticket.commented' }),
    ]);
    expect(solo).toEqual([]);
  });

  it('a close followed by a DIFFERENT actor is the maker→reviewer relay, named at both ends', () => {
    const hs = deriveHandoffs([
      ev({ seq: 1, event_type: 'ticket.closed' }),
      ev({ seq: 2, event_type: 'ticket.commented', actor_id: 'challenger' }),
    ]);
    expect(hs).toHaveLength(1);
    expect(handoffLine(hs[0]!, nameOf)).toBe('Sam finished T-1 — handing to Wiggum');
  });

  it('a finished pipeline stage hands to whoever picks the work up', () => {
    const hs = deriveHandoffs([
      ev({
        seq: 1,
        event_type: 'pipeline.blueprint_ready',
        actor_id: 'architecture-designer',
        ticket_id: null,
      }),
      ev({ seq: 2, event_type: 'ticket.claimed', actor_id: 'coding-agent' }),
    ]);
    expect(handoffLine(hs[0]!, nameOf)).toBe('Blue finished the blueprint — handing to Sam');
  });

  it('a ticket merely sitting in review is NOT a handoff — nobody has picked it up yet', () => {
    expect(deriveHandoffs([ev({ seq: 1, event_type: 'ticket.started' })])).toEqual([]);
  });

  it('scoped berth ids resolve to their role, and an unknown actor keeps its raw id', () => {
    const hs = deriveHandoffs([
      ev({ seq: 1, event_type: 'ticket.closed', actor_id: 'berth-2:coding-agent' }),
      ev({ seq: 2, event_type: 'ticket.accepted', actor_id: 'mystery' }),
    ]);
    expect(handoffLine(hs[0]!, nameOf)).toBe('Sam finished T-1 — handing to mystery');
  });
});
