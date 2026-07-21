// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FieldReportForm } from './FieldReportForm.js';
import type { FieldReportDraft } from './types.js';

afterEach(() => {
  cleanup();
});

const DRAFT: FieldReportDraft = {
  ticketId: 'W1-01',
  source: 'trace',
  sourceRef: 'trace:run-1:5',
  whatHappened: 'The gate passed on a spoofed receipt.',
  expected: '',
  evidenceLinks: ['run:run-1'],
};

describe('FieldReportForm', () => {
  it('renders pre-filled fields from the draft, including its source', () => {
    render(
      <FieldReportForm
        initialDraft={DRAFT}
        onSubmit={vi.fn()}
        submitting={false}
        error={null}
      />,
    );
    expect(screen.getByLabelText('What happened')).toHaveProperty(
      'value',
      'The gate passed on a spoofed receipt.',
    );
    expect(screen.getByText(/Filed from trace: trace:run-1:5/)).toBeTruthy();
    expect(screen.getByText('run:run-1')).toBeTruthy();
  });

  it('disables submit until both narrative fields are non-blank', () => {
    render(
      <FieldReportForm
        initialDraft={{ ...DRAFT, whatHappened: '', expected: '' }}
        onSubmit={vi.fn()}
        submitting={false}
        error={null}
      />,
    );
    const submit = screen.getByRole('button', { name: 'File field report' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('What happened'), {
      target: { value: 'It broke.' },
    });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('What you expected'), {
      target: { value: 'It should not break.' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('adds and removes evidence links, and submits the final draft', () => {
    const onSubmit = vi.fn();
    render(
      <FieldReportForm
        initialDraft={{ ...DRAFT, expected: 'expected text' }}
        onSubmit={onSubmit}
        submitting={false}
        error={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add evidence link'), {
      target: { value: 'receipt:9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('receipt:9')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove evidence link run:run-1' }),
    );
    expect(screen.queryByText('run:run-1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'File field report' }));
    expect(onSubmit).toHaveBeenCalledWith({
      ...DRAFT,
      expected: 'expected text',
      evidenceLinks: ['receipt:9'],
    });
  });

  it('shows an error and calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <FieldReportForm
        initialDraft={DRAFT}
        onSubmit={vi.fn()}
        onCancel={onCancel}
        submitting={false}
        error="filing failed"
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('filing failed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
