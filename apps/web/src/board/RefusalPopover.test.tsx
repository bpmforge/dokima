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
