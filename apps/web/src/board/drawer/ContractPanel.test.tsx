// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoardTicket } from '../test-helpers.js';
import { ContractPanel } from './ContractPanel.js';

afterEach(cleanup);

describe('ContractPanel', () => {
  it('says a blocked ticket is blocked, on what, and links the blocker', () => {
    const onOpenTicket = vi.fn();
    const ticket = makeBoardTicket({ id: 'T-2', status: 'blocked', dependsOn: ['T-1'] });
    render(<ContractPanel ticket={ticket} blockers={['T-1']} onOpenTicket={onOpenTicket} />);

    const state = screen.getByTestId('drawer-state');
    expect(state.textContent).toContain('Blocked');
    expect(state.textContent).toContain('Blocked on T-1');
    fireEvent.click(screen.getByRole('button', { name: 'Open ticket T-1' }));
    expect(onOpenTicket).toHaveBeenCalledWith('T-1');
  });
});
