// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefusalPopover } from './RefusalPopover.js';
import type { ProblemDetails } from './types.js';

afterEach(cleanup);

const PROBLEM: ProblemDetails = {
  type: 'about:blank',
  title: 'refused',
  status: 409,
  detail: 'Tickets need a passing gate before review.',
  rule: 'FR-T2',
  instance: '/tickets/T-1/close',
  request_id: 'req-1',
};

/**
 * W13-60: the popover used to LEAD with the SRS/SC requirement id — an
 * opaque builder code where the explanation of why the board said no
 * should be. The human sentence leads now; the id stays as provenance
 * (the e2e contract still asserts the rule id is visible).
 */
describe('RefusalPopover (W13-60)', () => {
  it('RED FIXTURE: the human explanation precedes the rule id, and the id survives as a provenance tag', () => {
    render(
      <RefusalPopover
        ticketId="T-1"
        problem={PROBLEM}
        onDismiss={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('refusal-T-1');
    const detail = popover.querySelector('.board-refusal__detail');
    const rule = popover.querySelector('.board-refusal__rule--tag');
    expect(detail?.textContent).toBe('Tickets need a passing gate before review.');
    expect(rule?.textContent).toContain('FR-T2');
    // DOM order is the reading order: explanation first.
    expect(
      detail!.compareDocumentPosition(rule!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('RefusalPopover shows its evidence and its fix (review F1)', () => {
  it('RED FIXTURE: names the ticket, renders the evidence, and states the fix as an instruction when no action is wired', () => {
    render(
      <RefusalPopover
        ticketId="T-1"
        problem={{
          ...PROBLEM,
          evidence: { gate: 'verify', exitCode: 1, fix: 'Run the ticket verify and fix the failing test.' },
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('refusal-ticket').textContent).toContain('T-1');
    const evidence = screen.getByTestId('refusal-evidence');
    expect(evidence.tagName).toBe('DETAILS');
    expect(evidence.textContent).toContain('What the board checked');
    expect(evidence.textContent).toContain('"exitCode": 1');
    expect(evidence.textContent).not.toContain('Run the ticket verify');
    expect(screen.getByTestId('refusal-fix').textContent).toBe(
      'To fix: Run the ticket verify and fix the failing test.',
    );
  });

  it('a wired fix action renders as a button instead of the instruction', () => {
    const onRunFix = vi.fn();
    render(
      <RefusalPopover
        ticketId="T-1"
        problem={{ ...PROBLEM, evidence: { fix: 'Do the thing' } }}
        onDismiss={vi.fn()}
        onRunFix={onRunFix}
      />,
    );
    expect(screen.queryByTestId('refusal-fix')).toBeNull();
    expect(screen.queryByTestId('refusal-evidence')).toBeNull();
    screen.getByRole('button', { name: 'Do the thing' }).click();
    expect(onRunFix).toHaveBeenCalledOnce();
  });

  it('no evidence → no empty disclosure', () => {
    render(<RefusalPopover ticketId="T-1" problem={PROBLEM} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('refusal-evidence')).toBeNull();
    expect(screen.queryByTestId('refusal-fix')).toBeNull();
  });
});
