// @vitest-environment jsdom
/**
 * Triage flow (BLUEPRINT §12.6): pending reports render with Accept ->
 * Playbook / Accept -> Ticket / Reject actions; a self-filed report disables
 * them (UX nicety — the server is the real enforcement,
 * `packages/memory/src/lessons/triage.ts`'s `SelfTriageError`). Mocks
 * `./api.js` so components are exercised without a real server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from './api.js';
import { TriageQueue } from './TriageQueue.js';
import type { FieldReportRecord } from './types.js';

vi.mock('./api.js', () => ({
  listFieldReports: vi.fn(),
  triageFieldReport: vi.fn(),
}));

const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OPTS = { baseUrl: 'http://x', token: 'tok' };

function makeReport(overrides: Partial<FieldReportRecord> = {}): FieldReportRecord {
  return {
    id: 1,
    ticketId: 'W1-01',
    source: 'manual',
    sourceRef: null,
    whatHappened: 'The gate accepted a spoofed receipt.',
    expected: 'The gate should refuse.',
    evidenceLinks: ['run:run-1'],
    filedBy: 'human-brad',
    filedAt: '2026-07-20T09:00:00.000Z',
    status: 'pending',
    triagedBy: null,
    triagedAt: null,
    triageNote: null,
    resultingPlaybookEntryId: null,
    resultingTicketId: null,
    ...overrides,
  };
}

describe('TriageQueue', () => {
  it('shows an empty state when there is nothing to triage', async () => {
    mockedApi.listFieldReports.mockResolvedValue({ ok: true, data: [] });
    render(<TriageQueue apiOpts={OPTS} projectId="proj-1" actorId="challenger-1" />);
    await screen.findByTestId('triage-queue-empty');
  });

  it('accepts a report into the playbook', async () => {
    const report = makeReport();
    mockedApi.listFieldReports.mockResolvedValue({ ok: true, data: [report] });
    mockedApi.triageFieldReport.mockResolvedValue({
      ok: true,
      data: { ...report, status: 'accepted_playbook' },
    });

    render(<TriageQueue apiOpts={OPTS} projectId="proj-1" actorId="challenger-1" />);
    await screen.findByTestId('triage-item-1');

    fireEvent.click(screen.getByRole('button', { name: 'Accept → Playbook' }));
    fireEvent.change(screen.getByLabelText('Task class for report 1'), {
      target: { value: 'spoofed receipt bypass' },
    });
    fireEvent.change(screen.getByLabelText('Playbook entry for report 1'), {
      target: { value: 'verify signature before accepting a receipt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(mockedApi.triageFieldReport).toHaveBeenCalledWith(OPTS, 'proj-1', 1, {
        decision: 'playbook',
        taskClass: 'spoofed receipt bypass',
        entry: 'verify signature before accepting a receipt',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('triage-item-1')).toBeNull());
  });

  it('prepares a validator-fix ticket', async () => {
    const report = makeReport();
    mockedApi.listFieldReports.mockResolvedValue({ ok: true, data: [report] });
    mockedApi.triageFieldReport.mockResolvedValue({
      ok: true,
      data: { ...report, status: 'accepted_ticket' },
    });

    render(<TriageQueue apiOpts={OPTS} projectId="proj-1" actorId="challenger-1" />);
    await screen.findByTestId('triage-item-1');

    fireEvent.click(
      screen.getByRole('button', { name: 'Accept → Validator-fix ticket' }),
    );
    fireEvent.change(screen.getByLabelText('Ticket id for report 1'), {
      target: { value: 'W9-42' },
    });
    fireEvent.change(screen.getByLabelText('Ticket title for report 1'), {
      target: { value: 'Gate accepts spoofed receipt' },
    });
    fireEvent.change(screen.getByLabelText('Ticket lane for report 1'), {
      target: { value: 'core' },
    });
    fireEvent.change(screen.getByLabelText('Ticket write scope for report 1'), {
      target: { value: 'packages/events/src/receipts.ts, packages/events/src/gate.ts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(mockedApi.triageFieldReport).toHaveBeenCalledWith(OPTS, 'proj-1', 1, {
        decision: 'ticket',
        ticketId: 'W9-42',
        title: 'Gate accepts spoofed receipt',
        lane: 'core',
        writeScope: ['packages/events/src/receipts.ts', 'packages/events/src/gate.ts'],
      }),
    );
  });

  it('rejects a report', async () => {
    const report = makeReport();
    mockedApi.listFieldReports.mockResolvedValue({ ok: true, data: [report] });
    mockedApi.triageFieldReport.mockResolvedValue({
      ok: true,
      data: { ...report, status: 'rejected' },
    });

    render(<TriageQueue apiOpts={OPTS} projectId="proj-1" actorId="challenger-1" />);
    await screen.findByTestId('triage-item-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(mockedApi.triageFieldReport).toHaveBeenCalledWith(OPTS, 'proj-1', 1, {
        decision: 'reject',
      }),
    );
  });

  it('disables triage actions and shows a notice when the actor filed the report themselves', async () => {
    const report = makeReport({ filedBy: 'challenger-1' });
    mockedApi.listFieldReports.mockResolvedValue({ ok: true, data: [report] });

    render(<TriageQueue apiOpts={OPTS} projectId="proj-1" actorId="challenger-1" />);
    await screen.findByTestId('triage-item-1-self-filed');
    expect(
      screen.getByRole('button', { name: 'Accept → Playbook' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Reject' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows a per-report error on a triage refusal without removing the report', async () => {
    const report = makeReport();
    mockedApi.listFieldReports.mockResolvedValue({ ok: true, data: [report] });
    mockedApi.triageFieldReport.mockResolvedValue({
      ok: false,
      problem: {
        type: 'about:blank',
        title: 'self-triage refused',
        status: 409,
        detail: 'triage requires an actor distinct from the report filer',
        instance: '/field-reports/1/triage',
        request_id: 'req-1',
      },
    });

    render(<TriageQueue apiOpts={OPTS} projectId="proj-1" actorId="challenger-1" />);
    await screen.findByTestId('triage-item-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'triage requires an actor distinct',
      ),
    );
    expect(screen.getByTestId('triage-item-1')).toBeTruthy();
  });
});
