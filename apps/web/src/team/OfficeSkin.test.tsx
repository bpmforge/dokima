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
    // W21-01: rooms are painted on the canvas now, so the ROOM a member is in
    // is asserted per figure rather than per section — strictly stronger, and
    // it survives any future change of renderer.
    const waiting = screen.getByTestId('office-figure-coding-agent');
    expect(waiting.getAttribute('data-pose')).toBe('standing-waiting');
    expect(waiting.getAttribute('data-place')).toBe('your-office');
    const idle = screen.getByTestId('office-figure-release-manager');
    expect(idle.getAttribute('data-pose')).toBe('sitting-idle');
    expect(idle.getAttribute('data-place')).toBe('break-room');
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

describe('OfficeSkin as a painted room (W21-01)', () => {
  it('the canvas is decorative — every fact it paints is also a real element above it', () => {
    render(<OfficeSkin members={MEMBERS} tickets={[]} heartbeats={new Map()} asks={[]} />);
    const stage = screen.getByTestId('office-stage');
    expect(stage.tagName).toBe('CANVAS');
    expect(stage.getAttribute('aria-hidden')).toBe('true');
    // Losing the canvas must not lose the office: the members are buttons.
    for (const m of MEMBERS) {
      const figure = screen.getByTestId(`office-figure-${m.actorId}`);
      expect(figure.tagName).toBe('BUTTON');
      expect(figure.textContent).toContain(m.displayName!);
    }
  });

  it('each figure is positioned at its own scene spot — nobody is stacked on anybody', () => {
    render(<OfficeSkin members={MEMBERS} tickets={[]} heartbeats={new Map()} asks={[]} />);
    const spots = MEMBERS.map((m) => {
      const slot = screen.getByTestId(`office-figure-${m.actorId}`).parentElement!;
      return `${slot.style.left},${slot.style.top}`;
    });
    expect(new Set(spots).size).toBe(MEMBERS.length);
    expect(spots.every((s) => s.includes('%'))).toBe(true);
  });
});
