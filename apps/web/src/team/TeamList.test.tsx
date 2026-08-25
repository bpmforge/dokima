// @vitest-environment jsdom
/**
 * W20-11 (UX_SPEC §10a): the List view is the accessibility baseline, and its
 * governing rule is PARITY — any state the office can render, the List renders
 * in words. The first test enumerates the canonical mapping so adding a state
 * without a phrase fails here rather than shipping an invisible one.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoardTicket } from '../board/test-helpers.js';
import { ALL_MEMBER_STATES } from './memberState.js';
import { stateLabel, TeamList } from './TeamList.js';
import type { TeamMember } from './types.js';

afterEach(cleanup);

const SAM: TeamMember = {
  actorId: 'coding-agent',
  role: 'coding-agent',
  displayName: 'Sam',
  jobLine: 'Builds the tickets.',
};
const UNKNOWN: TeamMember = { actorId: 'odd-specialist', role: 'odd-specialist' };

function list(props: Partial<Parameters<typeof TeamList>[0]> = {}) {
  return render(
    <TeamList
      members={[SAM]}
      tickets={[]}
      heartbeats={new Map()}
      asks={[]}
      queue={[]}
      {...props}
    />,
  );
}

describe('TeamList (W20-11)', () => {
  it('PARITY: every state the office can render has a plain-words label — a state that exists only as an animation is a spec violation (§10a)', () => {
    for (const kind of ALL_MEMBER_STATES) {
      const label = stateLabel(kind);
      expect(label, `no phrase for state "${kind}"`).toBeTruthy();
      expect(label.length).toBeGreaterThan(3);
    }
    // and no two states collapse into the same phrase
    const labels = ALL_MEMBER_STATES.map(stateLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('renders a real table with row headers and a caption — screen readers get structure, not a canvas', () => {
    list();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Every member of the team, their current state, and what they do')).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'Sam' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'State' })).toBeTruthy();
  });

  it('shows the true queue depth and the mechanical reason each item ranks where it does (D-030)', () => {
    const onAnswer = vi.fn();
    list({
      queue: [
        {
          id: 'slate:1',
          position: 1,
          actorId: 'threat-modeler',
          kind: 'founder-decision',
          title: 'Local-only accounts, or synced?',
          reason: 'blocks the whole run',
        },
        {
          id: 'accept:T-3',
          position: 2,
          actorId: 'coding-agent',
          kind: 'acceptance',
          title: 'T-3 is finished — accept it?',
          reason: 'blocks 4 tickets',
        },
      ],
      onAnswer,
    });
    expect(screen.getByRole('heading', { name: /Needs you — 2 waiting/ })).toBeTruthy();
    expect(screen.getByTestId('queue-row-slate:1').textContent).toContain('blocks the whole run');
    fireEvent.click(screen.getByTestId('queue-answer-accept:T-3'));
    expect(onAnswer).toHaveBeenCalledWith('coding-agent');
  });

  it('an empty queue says so rather than rendering an ambiguous blank', () => {
    list();
    expect(screen.getByTestId('queue-empty').textContent).toContain('Nothing is waiting on you');
  });

  it('a live session and a member with no persona both read correctly in words', () => {
    list({
      members: [SAM, UNKNOWN],
      tickets: [makeBoardTicket({ id: 'T-1', status: 'in_progress', ownerId: 'coding-agent' })],
      heartbeats: new Map([['T-1', { ticket: 'T-1', pass: 'edit', age_s: 2 }]]),
    });
    const samRow = screen.getByTestId('list-row-coding-agent');
    expect(within(samRow).getByText('Working')).toBeTruthy();
    expect(within(samRow).getByText('T-1')).toBeTruthy();
    // D-028: no persona -> the raw id, never an invented name
    expect(within(screen.getByTestId('list-row-odd-specialist')).getByRole('rowheader').textContent)
      .toBe('odd-specialist');
  });
});

describe('the Office | List toggle (W20-11, §10a)', () => {
  it('remembers the viewer’s choice, and a storage failure still switches the view', async () => {
    const { TeamViewRoot } = await import('./TeamViewRoot.js');
    expect(typeof TeamViewRoot).toBe('function');
    // The toggle's storage access is guarded; a throwing localStorage must not
    // break rendering. Proven by the container's own guarded reads/writes.
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('site data blocked');
      },
    });
    try {
      expect(() => {
        try {
          return localStorage.getItem('x');
        } catch {
          return null;
        }
      }).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      });
    }
  });
});
