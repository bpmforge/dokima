// @vitest-environment jsdom
/**
 * The mountable "File field report" action (UX_SPEC §7 G-10c). Mocks
 * `./api.js` so the component is exercised without a real server — same
 * pattern as `../decisions/DecisionsBoard.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from './api.js';
import { FileFieldReportAction } from './FileFieldReportAction.js';
import type { FieldReportDraft, FieldReportRecord } from './types.js';

vi.mock('./api.js', () => ({
  fileFieldReport: vi.fn(),
}));

const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DRAFT: FieldReportDraft = {
  ticketId: 'W1-01',
  source: 'trace',
  sourceRef: 'trace:run-1:5',
  whatHappened: 'gate passed on a spoofed receipt',
  expected: '',
  evidenceLinks: [],
};

const OPTS = { baseUrl: 'http://x', token: 'tok' };

describe('FileFieldReportAction', () => {
  it('starts as just the action button; clicking reveals the pre-filled form', () => {
    render(<FileFieldReportAction apiOpts={OPTS} projectId="proj-1" draft={DRAFT} />);
    expect(screen.queryByTestId('field-report-form')).toBeNull();

    fireEvent.click(screen.getByTestId('file-field-report-action'));
    expect(screen.getByTestId('field-report-form')).toBeTruthy();
    expect(screen.getByLabelText('What happened')).toHaveProperty(
      'value',
      'gate passed on a spoofed receipt',
    );
  });

  it('files the report and calls onFiled, closing the form', async () => {
    const record: FieldReportRecord = {
      id: 1,
      ticketId: 'W1-01',
      source: 'trace',
      sourceRef: 'trace:run-1:5',
      whatHappened: 'gate passed on a spoofed receipt',
      expected: 'should refuse',
      evidenceLinks: [],
      filedBy: 'human-brad',
      filedAt: '2026-07-20T09:00:00.000Z',
      status: 'pending',
      triagedBy: null,
      triagedAt: null,
      triageNote: null,
      resultingPlaybookEntryId: null,
      resultingTicketId: null,
    };
    mockedApi.fileFieldReport.mockResolvedValue({ ok: true, data: record });
    const onFiled = vi.fn();

    render(
      <FileFieldReportAction
        apiOpts={OPTS}
        projectId="proj-1"
        draft={DRAFT}
        onFiled={onFiled}
      />,
    );
    fireEvent.click(screen.getByTestId('file-field-report-action'));
    fireEvent.change(screen.getByLabelText('What you expected'), {
      target: { value: 'should refuse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File field report' }));

    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(record));
    expect(mockedApi.fileFieldReport).toHaveBeenCalledWith(OPTS, 'proj-1', {
      ...DRAFT,
      expected: 'should refuse',
    });
    expect(screen.queryByTestId('field-report-form')).toBeNull();
  });

  it('shows an error and keeps the form open on a refusal', async () => {
    mockedApi.fileFieldReport.mockResolvedValue({
      ok: false,
      problem: {
        type: 'about:blank',
        title: 'incomplete field report',
        status: 422,
        detail: 'whatHappened is required',
        instance: '/x',
        request_id: 'req-1',
      },
    });

    render(<FileFieldReportAction apiOpts={OPTS} projectId="proj-1" draft={DRAFT} />);
    fireEvent.click(screen.getByTestId('file-field-report-action'));
    fireEvent.change(screen.getByLabelText('What you expected'), {
      target: { value: 'should refuse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File field report' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('whatHappened is required'),
    );
    expect(screen.getByTestId('field-report-form')).toBeTruthy();
  });
});
