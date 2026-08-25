// @vitest-environment jsdom
/** W20-03: the diary renders receipts-backed lines, and says so plainly when there are none. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry } from './diary.js';
import { WorkDiary } from './WorkDiary.js';

afterEach(cleanup);

const entry = (over: Partial<DiaryEntry> & { seq: number }): DiaryEntry => ({
  at: '2026-08-24T14:02:00.000Z',
  line: 'claimed a ticket',
  eventType: 'ticket.claimed',
  ticketId: 'T-1',
  receiptId: null,
  ...over,
});

describe('WorkDiary (W20-03)', () => {
  it('RED FIXTURE: a member with no events says so — never a hopeful blank the reader has to interpret', () => {
    render(<WorkDiary displayName="Shipp" entries={[]} total={0} />);
    expect(screen.getByTestId('diary-empty').textContent).toContain(
      "Shipp hasn’t done anything on this project yet",
    );
  });

  it('renders a receipt when one was minted, and links each line to the trace it came from', () => {
    const onOpenTrace = vi.fn();
    render(
      <WorkDiary
        displayName="Blue"
        entries={[entry({ seq: 5, line: 'phase advanced', receiptId: 'r-8f2c' })]}
        total={1}
        onOpenTrace={onOpenTrace}
      />,
    );
    expect(screen.getByTestId('diary-entry-5').textContent).toContain('receipt r-8f2c');
    fireEvent.click(screen.getByTestId('diary-evidence-5'));
    expect(onOpenTrace).toHaveBeenCalledWith('T-1');
  });

  it('a trimmed diary says how much it is not showing — a cap must never read as the whole story', () => {
    render(
      <WorkDiary
        displayName="Sam"
        entries={[entry({ seq: 1 }), entry({ seq: 2 })]}
        total={30}
      />,
    );
    expect(screen.getByTestId('diary-more').textContent).toContain('most recent 2 of 30');
  });
});
