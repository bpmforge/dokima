// @vitest-environment jsdom
/**
 * Session-trace view mount (UX_SPEC §7 G-10c): every trace event carries a
 * "File field report" action, pre-filled from that event; an escalation-
 * typed event (`event_type` starting `escalation.`) renders as an
 * escalation event card instead of a plain trace row, with the action
 * pre-filled via `draftFromEscalationEvent`. Mocks `./api.js` and
 * `../../lessons/api.js` so the component is exercised without a real
 * server, same pattern as `../../lessons/FileFieldReportAction.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as drawerApi from './api.js';
import * as lessonsApi from '../../lessons/api.js';
import { TelemetryPanel } from './TelemetryPanel.js';
import type { TraceEvent } from './types.js';
import type { FieldReportRecord } from '../../lessons/types.js';

vi.mock('./api.js', () => ({
  fetchSpendByRung: vi.fn(),
  fetchTicketRuns: vi.fn(),
  fetchRunTrace: vi.fn(),
}));
vi.mock('../../lessons/api.js', () => ({
  fileFieldReport: vi.fn(),
}));

const mockedDrawerApi = vi.mocked(drawerApi);
const mockedLessonsApi = vi.mocked(lessonsApi);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const API_OPTS = { baseUrl: 'http://x', token: 'tok' };

const TRACE_EVENT: TraceEvent = {
  seq: 5,
  event_type: 'ticket.claimed',
  actor_id: 'agent-1',
  ticket_id: 'W1-01',
  run_id: 'run-1',
  payload: null,
  created_at: '2026-07-20T09:00:00.000Z',
};

const ESCALATION_EVENT: TraceEvent = {
  seq: 6,
  event_type: 'escalation.rung_advanced',
  actor_id: 'agent-1',
  ticket_id: 'W1-01',
  run_id: 'run-1',
  payload: { fromRung: 'R1', toRung: 'R2', receiptId: 'rcpt-1' },
  created_at: '2026-07-20T09:05:00.000Z',
};

async function renderWithTrace(events: TraceEvent[]) {
  mockedDrawerApi.fetchSpendByRung.mockResolvedValue({ items: [], assumptions: [] });
  mockedDrawerApi.fetchTicketRuns.mockResolvedValue(['run-1']);
  mockedDrawerApi.fetchRunTrace.mockResolvedValue(events);

  render(
    <TelemetryPanel
      apiOpts={API_OPTS}
      projectId="proj-1"
      ticketId="W1-01"
      heartbeat={undefined}
    />,
  );
  await waitFor(() => screen.getByTestId('session-trace-runs'));
  fireEvent.click(screen.getByRole('button', { name: /View session trace/ }));
  await waitFor(() => screen.getByTestId('session-trace-events'));
}

describe('TelemetryPanel session-trace entry points', () => {
  it('renders a plain trace event as a trace-event-row with a File field report action', async () => {
    await renderWithTrace([TRACE_EVENT]);

    expect(screen.getAllByTestId('trace-event-row')).toHaveLength(1);
    expect(screen.queryByTestId('escalation-event-card')).toBeNull();
    expect(screen.getByTestId('file-field-report-action')).toBeTruthy();
  });

  it('renders an escalation-typed event as an escalation-event-card', async () => {
    await renderWithTrace([ESCALATION_EVENT]);

    expect(screen.getByTestId('escalation-event-card')).toBeTruthy();
    expect(screen.queryByTestId('trace-event-row')).toBeNull();
  });

  it('files a report pre-filled from a plain trace event', async () => {
    await renderWithTrace([TRACE_EVENT]);
    const record: FieldReportRecord = {
      id: 1,
      ticketId: 'W1-01',
      source: 'trace',
      sourceRef: 'trace:run-1:5',
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
    };
    mockedLessonsApi.fileFieldReport.mockResolvedValue({ ok: true, data: record });

    fireEvent.click(screen.getByTestId('file-field-report-action'));
    fireEvent.change(screen.getByLabelText('What you expected'), {
      target: { value: 'should have refused' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File field report' }));

    await waitFor(() => expect(mockedLessonsApi.fileFieldReport).toHaveBeenCalled());
    const [, , draft] = mockedLessonsApi.fileFieldReport.mock.calls[0]!;
    expect(draft).toMatchObject({ source: 'trace', sourceRef: 'trace:run-1:5' });
  });

  it('files a report pre-filled from an escalation event, sourced "escalation"', async () => {
    await renderWithTrace([ESCALATION_EVENT]);
    const record: FieldReportRecord = {
      id: 2,
      ticketId: 'W1-01',
      source: 'escalation',
      sourceRef: 'escalation:W1-01:2026-07-20T09:05:00.000Z',
      whatHappened: 'x',
      expected: 'y',
      evidenceLinks: ['receipt:rcpt-1'],
      filedBy: 'operator',
      filedAt: '2026-07-20T09:10:00.000Z',
      status: 'pending',
      triagedBy: null,
      triagedAt: null,
      triageNote: null,
      resultingPlaybookEntryId: null,
      resultingTicketId: null,
    };
    mockedLessonsApi.fileFieldReport.mockResolvedValue({ ok: true, data: record });

    fireEvent.click(screen.getByTestId('file-field-report-action'));
    fireEvent.change(screen.getByLabelText('What you expected'), {
      target: { value: 'should not have escalated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File field report' }));

    await waitFor(() => expect(mockedLessonsApi.fileFieldReport).toHaveBeenCalled());
    const [, , draft] = mockedLessonsApi.fileFieldReport.mock.calls[0]!;
    expect(draft).toMatchObject({
      source: 'escalation',
      evidenceLinks: ['receipt:rcpt-1'],
    });
  });
});

describe('drawer telemetry speaks user language (W13-60)', () => {
  it('RED FIXTURE: the idle line is plain language, not undefined berth jargon, and rung is defined where spend first shows it', async () => {
    await renderWithTrace([TRACE_EVENT]);

    expect(
      screen.getByText(/No agent is working this ticket right now/),
    ).toBeTruthy();
    expect(screen.queryByText(/No active berth/)).toBeNull();
    expect(screen.getByTestId('spend-rung-hint').textContent).toContain(
      'ladder of models',
    );
  });

  it('a trace row leads with the human sentence and keeps the wire id', async () => {
    await renderWithTrace([TRACE_EVENT]);

    const row = screen.getByTestId('trace-event-row');
    expect(row.textContent).toContain('The ticket was claimed');
    expect(row.textContent).toContain('ticket.claimed');
  });
});
