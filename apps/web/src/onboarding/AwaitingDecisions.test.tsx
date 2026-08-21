// @vitest-environment jsdom
/**
 * W17-12: the decision screen notices when you are done, and the resume
 * wait shows the phase checklist instead of a dead button.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AwaitingDecisions } from './AwaitingDecisions.js';

vi.mock('../decisions/DecisionsBoard.js', () => ({
  DecisionsBoard: ({ onDecided }: { onDecided: () => void }) => (
    <button type="button" data-testid="fake-decide" onClick={onDecided}>
      decide
    </button>
  ),
}));

afterEach(cleanup);

const AWAITING = {
  status: 'awaiting_decisions' as const,
  run_id: 'run-1',
  reasons: [],
  decisions: [
    { key: 'a', slate_id: 's1', title: 'Platform' },
    { key: 'b', slate_id: 's2', title: 'Storage' },
  ],
};

function renderScreen(over: Partial<Parameters<typeof AwaitingDecisions>[0]> = {}) {
  return render(
    <AwaitingDecisions
      awaiting={AWAITING}
      projectId="p1"
      token="t"
      resuming={false}
      stillWaiting={null}
      resumeError={null}
      onDecided={vi.fn()}
      onContinue={vi.fn()}
      {...over}
    />,
  );
}

describe('AwaitingDecisions (W17-12)', () => {
  it('RED FIXTURE: after the LAST answer the header stops asking — "All answered — continue when ready"', () => {
    renderScreen();
    expect(screen.getByTestId('awaiting-header').textContent).toBe(
      'Your decision is needed',
    );
    fireEvent.click(screen.getByTestId('fake-decide'));
    expect(screen.getByTestId('awaiting-header').textContent).toBe(
      'Your decision is needed',
    );
    fireEvent.click(screen.getByTestId('fake-decide'));
    expect(screen.getByTestId('awaiting-header').textContent).toBe(
      'All answered — continue when ready',
    );
  });

  it('RED FIXTURE: while Continuing, the phase checklist is visible — blueprint marked kept, the rest pending — never a bare disabled button', () => {
    renderScreen({ resuming: true });
    const phases = screen.getByTestId('resume-phases');
    expect(phases.textContent).toContain('✓ Blueprint drafted (kept — not rebuilt)');
    expect(phases.textContent).toContain('… Technical slate built');
    expect(phases.textContent).toContain('… Board created');
    expect(
      (screen.getByTestId('interview-continue') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
