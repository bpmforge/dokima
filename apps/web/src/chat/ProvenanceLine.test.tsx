// @vitest-environment jsdom
/**
 * Review C2: the cost chip linked to `/api/v1/receipts/` with an empty id, as a
 * plain anchor with no bearer token — a click left the app for a raw 401 page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { formatTurnCost, ProvenanceLine } from './ProvenanceLine.js';
import type { Provenance } from './types.js';

afterEach(() => cleanup());

const base: Provenance = {
  agent: 'worker-1',
  model: 'm',
  ticketId: 'T-1',
  costUsd: 0.0312,
  receiptId: '',
};

describe('ProvenanceLine cost chip (review C2)', () => {
  it('RED FIXTURE: no receipt id → plain text, never a link', () => {
    render(<ProvenanceLine provenance={base} onOpenReceipt={() => undefined} />);
    const chip = screen.getByTestId('card-cost-link');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('href')).toBeNull();
    expect(chip.textContent).toBe('$0.03');
  });

  it('a real receipt opens in-app through the handler, not by navigating', () => {
    const onOpen = vi.fn();
    render(<ProvenanceLine provenance={{ ...base, receiptId: 'rcpt-1' }} onOpenReceipt={onOpen} />);
    const chip = screen.getByTestId('card-cost-link');
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('href')).toBeNull();
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith('rcpt-1');
  });

  it('formats cost to cents, with "<$0.01" for real sub-cent spend', () => {
    expect(formatTurnCost(0)).toBe('$0.00');
    expect(formatTurnCost(0.0004)).toBe('<$0.01');
    expect(formatTurnCost(1.234)).toBe('$1.23');
  });
});
