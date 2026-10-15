// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from './Card.js';
import { makeBoardTicket } from './test-helpers.js';

afterEach(cleanup);

/**
 * W13-60 — the two card defects the novice-journey audit measured:
 * a blocked card offered nothing (no verb lists 'blocked' as a source, so
 * no Move menu renders and every drag animates back), and the Move menu's
 * bare `claim → claimed` never said WHO claims or what it costs.
 */
describe('Card (W13-60)', () => {
  it('RED FIXTURE: a blocked card explains what it waits on and that it opens on its own — the state must not be a dead end', () => {
    const ticket = makeBoardTicket({
      id: 'T-9',
      status: 'blocked',
      dependsOn: ['T-2'],
    });
    render(
      <Card
        ticket={ticket}
        blockers={['T-2']}
        onDragStart={vi.fn()}
        onFireVerb={vi.fn()}
      />,
    );

    const why = screen.getByTestId('blocked-why-T-9');
    expect(why.textContent).toContain('Blocked on T-2');
    expect(why.textContent).toContain('on its own');
    // Still no Move menu — blocked genuinely has no exit verb; the sentence
    // is the affordance, not a fake control.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('RED FIXTURE: Move menu options name the actor and the consequence, not bare lifecycle verbs', () => {
    const ticket = makeBoardTicket({ id: 'T-1', status: 'ready' });
    render(<Card ticket={ticket} onDragStart={vi.fn()} onFireVerb={vi.fn()} />);

    const menu = screen.getByRole('combobox');
    const claim = within(menu).getByRole('option', { name: /Claim it yourself/ });
    // The click assigns the ticket to the person at the keyboard — it must
    // say so, and say that nothing is spent and no agent starts.
    expect(claim.textContent).toContain('starts no agent');
    expect(claim.textContent).toContain('Claimed');
    expect(within(menu).queryByRole('option', { name: /^claim → claimed$/ })).toBeNull();
  });
});

describe('Card keyboard and move safety', () => {
  it('choosing in the Move menu fires nothing until Move is pressed', () => {
    const onFireVerb = vi.fn();
    const ticket = makeBoardTicket({ id: 'T-1', status: 'ready' });
    render(<Card ticket={ticket} onDragStart={vi.fn()} onFireVerb={onFireVerb} />);

    const move = screen.getByTestId('move-T-1') as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'claim' } });
    expect(onFireVerb).not.toHaveBeenCalled();
    fireEvent.click(move);
    expect(onFireVerb).toHaveBeenCalledWith('T-1', 'claim');
  });

  it('accepting as Done needs a second press, because it cannot be undone', () => {
    const onFireVerb = vi.fn();
    const ticket = makeBoardTicket({ id: 'T-4', status: 'in_review' });
    render(<Card ticket={ticket} onDragStart={vi.fn()} onFireVerb={onFireVerb} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'accept' } });
    fireEvent.click(screen.getByTestId('move-T-4'));
    expect(onFireVerb).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('move-T-4'));
    expect(onFireVerb).toHaveBeenCalledWith('T-4', 'accept');
  });

  it('every card, including Done and Blocked, has a focusable way into the drawer', () => {
    for (const status of ['done', 'blocked'] as const) {
      const ticket = makeBoardTicket({ id: `T-${status}`, status, title: 'Title' });
      render(<Card ticket={ticket} onDragStart={vi.fn()} onFireVerb={vi.fn()} />);
      const open = screen.getByTestId(`open-T-${status}`);
      expect(open.tagName).toBe('BUTTON');
      cleanup();
    }
  });
});

describe('Card live heartbeat (review R1)', () => {
  it('shows what the agent is doing, and marks the line stale when beats stop', () => {
    vi.useFakeTimers();
    try {
      const start = Date.parse('2026-10-15T10:00:00Z');
      vi.setSystemTime(start);
      const ticket = makeBoardTicket({ id: 'T-1', status: 'in_progress' });
      render(
        <Card
          ticket={ticket}
          heartbeat={{
            ticket: 'T-1',
            run: 'run-1',
            phase: 'waiting_on_model',
            model: 'fake-model',
            age_s: 2,
            elapsed_s: 10,
            receivedAtMs: start,
          }}
          onDragStart={vi.fn()}
          onFireVerb={vi.fn()}
        />,
      );
      const line = screen.getByTestId('card-heartbeat-T-1');
      expect(line.textContent).toBe(
        'Waiting on the model · fake-model · 10s in · last activity 2s ago',
      );
      expect(line.getAttribute('data-stale')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(16_000);
      });
      expect(line.getAttribute('data-stale')).toBe('true');
      expect(line.textContent).toContain('last activity 18s ago · no update for 16s');
    } finally {
      vi.useRealTimers();
    }
  });
});
