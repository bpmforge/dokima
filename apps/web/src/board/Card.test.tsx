// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
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
