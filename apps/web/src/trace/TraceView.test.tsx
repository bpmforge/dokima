// @vitest-environment jsdom
/**
 * Dedicated session-trace replay view (BLUEPRINT §12.4). Mocks `./api.js`
 * and `../lessons/api.js` so the component is exercised without a real
 * server — same pattern as `board/drawer/TelemetryPanel.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import * as traceApi from './api.js';
import * as lessonsApi from '../lessons/api.js';
import { TraceView } from './TraceView.js';
import type { TraceEvent } from './api.js';

vi.mock('./api.js', () => ({
  fetchTicketRuns: vi.fn(),
  fetchRunTrace: vi.fn(),
}));
vi.mock('../lessons/api.js', () => ({
  fileFieldReport: vi.fn(),
}));

const mockedTraceApi = vi.mocked(traceApi);
const mockedLessonsApi = vi.mocked(lessonsApi);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const API_OPTS = { baseUrl: 'http://x', token: 'tok' };

const LIFECYCLE_EVENT: TraceEvent = {
  seq: 1,
  event_type: 'ticket.claimed',
  actor_id: 'agent-1',
  ticket_id: 'W1-01',
  run_id: 'run-1',
  payload: null,
  created_at: '2026-07-20T09:00:00.000Z',
};

const PASS_EVENT: TraceEvent = {
  seq: 2,
  event_type: 'loop.pass',
  actor_id: 'agent-1',
  ticket_id: 'W1-01',
  run_id: 'run-1',
  payload: { pass: 3 },
  created_at: '2026-07-20T09:01:00.000Z',
};

const GATE_EVENT: TraceEvent = {
  seq: 3,
  event_type: 'gate.receipt_minted',
  actor_id: 'agent-1',
  ticket_id: 'W1-01',
  run_id: 'run-1',
  payload: { validators: [{ name: 'lint', exitCode: 1, gapCount: 2 }] },
  created_at: '2026-07-20T09:02:00.000Z',
};

const ESCALATION_EVENT: TraceEvent = {
  seq: 4,
  event_type: 'escalation.rung_advanced',
  actor_id: 'agent-1',
  ticket_id: 'W1-01',
  run_id: 'run-1',
  payload: {
    fromRung: 'R0',
    toRung: 'R1',
    receiptId: 'rcpt-1',
    reason: 'validator gap persisted',
  },
  created_at: '2026-07-20T09:03:00.000Z',
};

describe('TraceView', () => {
  it('renders the honest-empty state when the ticket has no runs', async () => {
    mockedTraceApi.fetchTicketRuns.mockResolvedValue([]);

    render(
      <TraceView
        apiOpts={API_OPTS}
        projectId="proj-1"
        ticketId="W1-01"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByTestId('trace-view-empty'));
    expect(mockedTraceApi.fetchRunTrace).not.toHaveBeenCalled();
  });

  it('lists runs, then replays events labeled by kind with a pass number when present', async () => {
    mockedTraceApi.fetchTicketRuns.mockResolvedValue(['run-1']);
    mockedTraceApi.fetchRunTrace.mockResolvedValue([
      LIFECYCLE_EVENT,
      PASS_EVENT,
      GATE_EVENT,
      ESCALATION_EVENT,
    ]);

    render(
      <TraceView
        apiOpts={API_OPTS}
        projectId="proj-1"
        ticketId="W1-01"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByTestId('trace-view-runs'));
    fireEvent.click(screen.getByRole('button', { name: /View session trace/ }));
    await waitFor(() => screen.getByTestId('trace-view-events'));

    const rows = screen.getAllByTestId('trace-view-event-row');
    expect(rows).toHaveLength(4);
    expect(screen.getByText('Ticket lifecycle')).toBeTruthy();
    expect(screen.getByText('Pass')).toBeTruthy();
    expect(screen.getByText('Pass 3')).toBeTruthy();
    expect(screen.getByText('Gate result')).toBeTruthy();
    expect(screen.getByText('Escalation')).toBeTruthy();
    expect(screen.getAllByTestId('file-field-report-action')).toHaveLength(4);

    const [lifecycleRow, passRow, gateRow, escalationRow] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    for (const row of [lifecycleRow, passRow, gateRow, escalationRow]) {
      expect(within(row).queryByText(/^\d{4}-\d{2}-\d{2}T/)).toBeNull();
    }

    const lifecycleTime = lifecycleRow.querySelector('time');
    expect(lifecycleTime?.getAttribute('datetime')).toBe(LIFECYCLE_EVENT.created_at);
    expect(lifecycleTime?.textContent).not.toContain('+');

    expect(passRow.querySelector('time')?.textContent).toContain('+1m00s');
    expect(gateRow.querySelector('time')?.textContent).toContain('+1m00s');
    expect(escalationRow.querySelector('time')?.textContent).toContain('+1m00s');
  });

  it('RED FIXTURE: renders an escalation row with its rungs and reason, not the bare event id alone', async () => {
    mockedTraceApi.fetchTicketRuns.mockResolvedValue(['run-1']);
    mockedTraceApi.fetchRunTrace.mockResolvedValue([ESCALATION_EVENT]);

    render(
      <TraceView
        apiOpts={API_OPTS}
        projectId="proj-1"
        ticketId="W1-01"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByTestId('trace-view-runs'));
    fireEvent.click(screen.getByRole('button', { name: /View session trace/ }));
    await waitFor(() => screen.getByTestId('trace-view-events'));

    const row = screen.getByTestId('trace-view-event-row');
    const detail = within(row).getByTestId('trace-event-escalation-detail');
    expect(detail.textContent).toContain('R0 → R1');
    expect(detail.textContent).toContain('validator gap persisted');
  });

  it('never reads payload.validators off a gate event — validators live in the receipts table, not the event log', async () => {
    mockedTraceApi.fetchTicketRuns.mockResolvedValue(['run-1']);
    mockedTraceApi.fetchRunTrace.mockResolvedValue([GATE_EVENT]);

    render(
      <TraceView
        apiOpts={API_OPTS}
        projectId="proj-1"
        ticketId="W1-01"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByTestId('trace-view-runs'));
    fireEvent.click(screen.getByRole('button', { name: /View session trace/ }));
    await waitFor(() => screen.getByTestId('trace-view-events'));

    const row = screen.getByTestId('trace-view-event-row');
    expect(within(row).queryByTestId('trace-event-validators')).toBeNull();
    expect(within(row).queryByText(/lint/)).toBeNull();
  });

  it('feeds the lessons form pre-filled from the selected event', async () => {
    mockedTraceApi.fetchTicketRuns.mockResolvedValue(['run-1']);
    mockedTraceApi.fetchRunTrace.mockResolvedValue([LIFECYCLE_EVENT]);
    mockedLessonsApi.fileFieldReport.mockResolvedValue({
      ok: true,
      data: {
        id: 1,
        ticketId: 'W1-01',
        source: 'trace',
        sourceRef: 'trace:run-1:1',
        whatHappened: 'x',
        expected: 'y',
        evidenceLinks: [],
        filedBy: 'operator',
        filedAt: '2026-07-20T09:10:00.000Z',
        status: 'pending',
        triagedBy: null,
        triagedAt: null,
        triageNote: null,
        resultingPlaybookEntryId: null,
        resultingTicketId: null,
      },
    });

    render(
      <TraceView
        apiOpts={API_OPTS}
        projectId="proj-1"
        ticketId="W1-01"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByTestId('trace-view-runs'));
    fireEvent.click(screen.getByRole('button', { name: /View session trace/ }));
    await waitFor(() => screen.getByTestId('trace-view-events'));

    fireEvent.click(screen.getByTestId('file-field-report-action'));
    fireEvent.change(screen.getByLabelText('What you expected'), {
      target: { value: 'should have refused' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File field report' }));

    await waitFor(() => expect(mockedLessonsApi.fileFieldReport).toHaveBeenCalled());
    const [, , draft] = mockedLessonsApi.fileFieldReport.mock.calls[0]!;
    expect(draft).toMatchObject({ source: 'trace', sourceRef: 'trace:run-1:1' });
  });
});
