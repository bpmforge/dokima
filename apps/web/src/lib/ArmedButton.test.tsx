// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArmedButton } from './ArmedButton.js';

describe('ArmedButton (W18-01)', () => {
  afterEach(cleanup);

  it('RED FIXTURE: one click alone executes nothing — the consequence stands between the clicks', () => {
    const onConfirm = vi.fn();
    render(
      <ArmedButton
        label="Remove 3 unavailable"
        armedLabel="Really remove 3? Click again"
        armedDetail="Registry entries only."
        testId="armed"
        onConfirm={onConfirm}
      />,
    );
    const button = screen.getByTestId('armed');
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Really remove 3? Click again');
    expect(screen.getByRole('status').textContent).toBe('Registry entries only.');
  });

  it('the second click executes and disarms', () => {
    const onConfirm = vi.fn();
    render(
      <ArmedButton label="Remove" armedLabel="Really?" testId="armed" onConfirm={onConfirm} />,
    );
    const button = screen.getByTestId('armed');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Remove');
  });

  it('the armed state times out back to rest', () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      render(
        <ArmedButton
          label="Remove"
          armedLabel="Really?"
          testId="armed"
          disarmAfterMs={1000}
          onConfirm={onConfirm}
        />,
      );
      const button = screen.getByTestId('armed');
      fireEvent.click(button);
      expect(button.textContent).toBe('Really?');
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(button.textContent).toBe('Remove');
      fireEvent.click(button);
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

});
