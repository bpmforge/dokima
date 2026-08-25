// @vitest-environment jsdom
/**
 * W20-08: the office renders the SAME states as the board, from the same
 * store. The fixture that matters proves the two modes agree — a skin that
 * disagreed with the board would be a second, prettier source of truth.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoardTicket } from '../board/test-helpers.js';
import { deriveMemberState } from './memberState.js';
import { OfficeSkin } from './OfficeSkin.js';
import type { TeamMember } from './types.js';

afterEach(cleanup);

const MEMBERS: TeamMember[] = [
  { actorId: 'coding-agent', role: 'coding-agent', displayName: 'Sam', avatar: '🔨' },
  { actorId: 'release-manager', role: 'release-manager', displayName: 'Shipp', avatar: '🚢' },
];

describe('OfficeSkin (W20-08)', () => {
  it('RED FIXTURE: the office renders exactly the state the board derived — a skin that disagreed would be a second source of truth', () => {
    const tickets = [
      makeBoardTicket({ id: 'T-1', status: 'in_progress', ownerId: 'coding-agent' }),
    ];
    const heartbeats = new Map([['T-1', { ticket: 'T-1', pass: 'edit', age_s: 2 }]]);
    render(
      <OfficeSkin members={MEMBERS} tickets={tickets} heartbeats={heartbeats} asks={[]} />,
    );
    const fromBoard = deriveMemberState({
      actorId: 'coding-agent',
      tickets,
      heartbeats,
      asks: [],
    });
    const figure = screen.getByTestId('office-figure-coding-agent');
    expect(figure.getAttribute('data-state')).toBe(fromBoard.kind);
    expect(figure.textContent).toContain(fromBoard.line);
  });

  it('a member waiting on you is drawn in YOUR OFFICE, and an idle one in the break room (W20-10, OPERATIONS.md)', () => {
    render(
      <OfficeSkin
        members={MEMBERS}
        tickets={[]}
        heartbeats={new Map()}
        asks={[{ actorId: 'coding-agent', ticketId: null, title: 'Approve?' }]}
      />,
    );
    expect(screen.getByTestId('office-room-your-office')).toBeTruthy();
    expect(
      screen.getByTestId('office-figure-coding-agent').getAttribute('data-pose'),
    ).toBe('standing-waiting');
    expect(
      screen.getByTestId('office-figure-release-manager').getAttribute('data-pose'),
    ).toBe('sitting-idle');
    expect(screen.getByTestId('office-room-break-room')).toBeTruthy();
  });

  it('every figure carries the reason its pose is on screen — the office explains itself, never narrates', () => {
    render(<OfficeSkin members={MEMBERS} tickets={[]} heartbeats={new Map()} asks={[]} />);
    const title = screen.getByTestId('office-figure-coding-agent').getAttribute('title');
    expect(title).toContain('nothing assigned');
    expect(title).toContain('no events in the live window');
    expect(screen.getByTestId('office-legend').textContent).toContain(
      'Nobody moves without evidence',
    );
  });

  it('clicking a figure opens the same member the board would', () => {
    const onSelect = vi.fn();
    render(
      <OfficeSkin
        members={MEMBERS}
        tickets={[]}
        heartbeats={new Map()}
        asks={[]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('office-figure-release-manager'));
    expect(onSelect).toHaveBeenCalledWith('release-manager');
  });
});
