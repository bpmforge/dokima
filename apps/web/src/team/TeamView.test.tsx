// @vitest-environment jsdom
/** W20-02: the Team view renders the canonical mapping — and never invents a face or a state. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoardTicket } from '../board/test-helpers.js';
import { TeamView } from './TeamView.js';
import type { TeamMember } from './types.js';

afterEach(cleanup);

const SAM: TeamMember = {
  actorId: 'coding-agent',
  role: 'coding-agent',
  displayName: 'Sam',
  avatar: '🔨',
  jobLine: 'Builds the tickets.',
};
const UNKNOWN: TeamMember = { actorId: 'weird-specialist', role: 'weird-specialist' };

function view(props: Partial<Parameters<typeof TeamView>[0]> = {}) {
  return render(
    <TeamView
      members={[SAM]}
      tickets={[]}
      heartbeats={new Map()}
      asks={[]}
      {...props}
    />,
  );
}

describe('TeamView (W20-02)', () => {
  it('RED FIXTURE (W20-02 + W20-14): a member with no persona is never given an invented name — the board counts it in the summary instead of carding it, and the List still shows its raw id', () => {
    view({ members: [SAM, UNKNOWN] });
    // Not carded — the board leads with the org so the team is not buried
    // under the capability catalogue (W20-14).
    expect(screen.queryByTestId('team-member-weird-specialist')).toBeNull();
    // …but counted exactly, never dropped (W20-12) and never renamed (D-028).
    expect(screen.getByTestId('team-others').textContent).toContain(
      '1 other specialist is available but unassigned',
    );
    // The raw-id guarantee itself lives where unpersonified members ARE
    // rendered: the List view (see TeamList.test.tsx) and the waiting room.
    expect(screen.getByTestId('team-member-coding-agent')).toBeTruthy();
  });

  it('a live heartbeat renders as working, with the ticket named', () => {
    view({
      tickets: [makeBoardTicket({ id: 'T-1', status: 'in_progress', ownerId: 'coding-agent' })],
      heartbeats: new Map([['T-1', { ticket: 'T-1', pass: 'edit', age_s: 2 }]]),
    });
    const state = screen.getByTestId('team-state-coding-agent');
    expect(state.textContent).toContain('building T-1');
    expect(state.parentElement?.getAttribute('data-state')).toBe('working');
  });

  it('a blocked-on-you member carries the action that clears it — the state and its fix travel together', () => {
    const onAnswer = vi.fn();
    view({
      asks: [{ actorId: 'coding-agent', ticketId: 'T-1', title: 'Raise the budget?' }],
      onAnswer,
    });
    const btn = screen.getByTestId('team-answer-coding-agent');
    expect(btn.textContent).toContain('Answer Sam');
    fireEvent.click(btn);
    expect(onAnswer).toHaveBeenCalledWith('coding-agent');
  });

  it('a member with nothing assigned says so plainly and offers no answer button', () => {
    view({ onAnswer: vi.fn() });
    expect(screen.getByTestId('team-state-coding-agent').textContent).toBe('nothing assigned');
    expect(screen.queryByTestId('team-answer-coding-agent')).toBeNull();
  });

  it('an empty roster degrades honestly instead of rendering an empty office', () => {
    view({ members: [] });
    expect(screen.getByTestId('team-empty').textContent).toContain('board view still works');
  });
});
