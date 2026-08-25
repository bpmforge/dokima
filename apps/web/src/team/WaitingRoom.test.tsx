// @vitest-environment jsdom
/**
 * W20-10 (D-030, OPERATIONS.md): the queue made physical. The two properties
 * that matter are that seat order IS queue order, and that a member blocked on
 * a PEER never appears — that absence is what distinguishes "blocked on you"
 * from merely "blocked".
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seatOfActor, type FounderQueue } from './founderQueue.js';
import type { TeamMember } from './types.js';
import { WaitingRoom } from './WaitingRoom.js';

afterEach(cleanup);

const MEMBERS: TeamMember[] = [
  { actorId: 'threat-modeler', role: 'threat-modeler', displayName: 'Locke' },
  { actorId: 'coding-agent', role: 'coding-agent', displayName: 'Sam' },
  { actorId: 'test-engineer', role: 'test-engineer', displayName: 'Tess' },
];

const QUEUE: FounderQueue = {
  depth: 2,
  rows: [
    {
      id: 'slate:1',
      kind: 'founder-decision',
      actorId: 'threat-modeler',
      title: 'Local-only accounts, or synced?',
      ticketId: null,
      position: 1,
      reason: 'blocks the whole run',
    },
    {
      id: 'accept:T-3',
      kind: 'acceptance',
      actorId: 'coding-agent',
      title: 'T-3 is finished — accept it?',
      ticketId: 'T-3',
      position: 2,
      reason: 'blocks 4 tickets',
    },
  ],
};

describe('WaitingRoom (W20-10)', () => {
  it('RED FIXTURE: a member blocked on a PEER is NOT in your office — only what waits on YOU takes a chair', () => {
    render(<WaitingRoom queue={QUEUE} members={MEMBERS} />);
    // Tess is busy and stuck behind a teammate; she has no chair.
    expect(screen.queryByText('Tess')).toBeNull();
    expect(seatOfActor(QUEUE, 'test-engineer')).toBeNull();
    // …while the two waiting on the founder are seated, in order.
    expect(seatOfActor(QUEUE, 'threat-modeler')).toBe(1);
    expect(seatOfActor(QUEUE, 'coding-agent')).toBe(2);
  });

  it('seat order IS queue order, and each chair says the mechanical reason it ranks there', () => {
    render(<WaitingRoom queue={QUEUE} members={MEMBERS} />);
    const first = screen.getByTestId('chair-1');
    const second = screen.getByTestId('chair-2');
    expect(within(first).getByText('Locke')).toBeTruthy();
    expect(first.textContent).toContain('blocks the whole run');
    expect(within(second).getByText('Sam')).toBeTruthy();
    expect(second.textContent).toContain('blocks 4 tickets');
    expect(screen.getByRole('heading', { name: /2 waiting on you/ })).toBeTruthy();
  });

  it('answering hands back the row, so the caller can open exactly that item', () => {
    const onAnswer = vi.fn();
    render(<WaitingRoom queue={QUEUE} members={MEMBERS} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByTestId('chair-answer-2'));
    expect(onAnswer).toHaveBeenCalledWith({ id: 'accept:T-3', actorId: 'coding-agent' });
  });

  it('an empty office says so AND says what it does not mean — a quiet office is not a stalled team', () => {
    render(<WaitingRoom queue={{ depth: 0, rows: [] }} members={MEMBERS} />);
    const empty = screen.getByTestId('waiting-empty');
    expect(empty.textContent).toContain('Nobody is waiting on you');
    expect(empty.textContent).toContain('stuck on a teammate is still at their desk');
  });

  it('a member with no persona is seated under its raw actor id, never an invented name (D-028)', () => {
    const q: FounderQueue = {
      depth: 1,
      rows: [{ ...QUEUE.rows[0]!, actorId: 'mystery-role', id: 'x:1', position: 1 }],
    };
    render(<WaitingRoom queue={q} members={MEMBERS} />);
    expect(within(screen.getByTestId('chair-1')).getByText('mystery-role')).toBeTruthy();
  });
});
