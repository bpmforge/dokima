// @vitest-environment jsdom
/** W19-04: the end-of-run summary — pure projection over the run's event slice. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TraceEvent } from './drawer/types.js';
import { RunSummary, summarizeRun } from './RunSummary.js';

afterEach(cleanup);

const ev = (over: Partial<TraceEvent>): TraceEvent => ({
  seq: 1,
  event_type: 'x',
  actor_id: 'a',
  ticket_id: null,
  run_id: 'r1',
  payload: null,
  created_at: '2026-08-21T00:00:00.000Z',
  ...over,
});

describe('summarizeRun (W19-04)', () => {
  it('RED FIXTURE: closes, parks (with the one-line why), spend, and the W19-01 gate line all come out of one event slice — before this card the founder had to visit four surfaces', () => {
    const events: TraceEvent[] = [
      ev({ event_type: 'ticket.closed', ticket_id: 'T-1' }),
      ev({ event_type: 'ticket.closed', ticket_id: 'T-2' }),
      ev({
        event_type: 'ticket.commented',
        ticket_id: 'T-3',
        payload: {
          body: 'Parked with evidence — cap reached.\nattempt 2/2: exceeded the tool-iteration budget (12)',
        },
      }),
      ev({ event_type: 'spend.recorded', payload: { costUsd: 0.5 } }),
      ev({ event_type: 'spend.recorded', payload: { costUsd: 0.25 } }),
      ev({ event_type: 'phase.advanced', payload: { from: 0, to: 1 } }),
    ];
    const s = summarizeRun(events);
    expect([...s.closed].sort()).toEqual(['T-1', 'T-2']);
    expect(s.parked).toEqual([
      { ticketId: 'T-3', reason: 'exceeded the tool-iteration budget (12)' },
    ]);
    expect(s.spendUsd).toBeCloseTo(0.75);
    expect(s.phaseLine).toContain('advanced from phase 0 to 1');
  });

  it('a ticket that parked and then CLOSED in the same run counts as closed, not parked', () => {
    const s = summarizeRun([
      ev({
        event_type: 'ticket.commented',
        ticket_id: 'T-1',
        payload: { body: 'Parked with evidence — x.\nattempt 1/2: y' },
      }),
      ev({ event_type: 'ticket.closed', ticket_id: 'T-1' }),
    ]);
    expect(s.closed).toEqual(['T-1']);
    expect(s.parked).toEqual([]);
  });
});

describe('RunSummary component', () => {
  it('renders counts, parked reasons, and the phase line from the fetched slice', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            ev({ event_type: 'ticket.closed', ticket_id: 'T-1' }),
            ev({
              event_type: 'ticket.commented',
              ticket_id: 'T-2',
              payload: { body: 'Parked with evidence — cap.\nattempt 1/2: ran out of budget' },
            }),
            ev({ event_type: 'phase.advanced', payload: { from: 0, to: 1 } }),
          ],
        }),
        { status: 200 },
      ),
    );
    render(
      <RunSummary
        apiOpts={{ baseUrl: '/api/v1', token: 't', fetchImpl: fetchImpl as never }}
        projectId="p1"
        runId="r1"
      />,
    );
    const counts = await screen.findByTestId('run-summary-counts');
    expect(counts.textContent).toContain('1 ticket closed');
    expect(counts.textContent).toContain('1 parked');
    expect(screen.getByTestId('run-summary-parked').textContent).toContain(
      'ran out of budget',
    );
    expect(screen.getByTestId('run-summary-phase').textContent).toContain(
      'advanced from phase 0 to 1',
    );
  });
});
