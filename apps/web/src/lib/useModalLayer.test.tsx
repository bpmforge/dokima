// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalLayer } from './useModalLayer.js';

function Layer({ name, onClose }: { name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalLayer(ref, onClose);
  return (
    <div ref={ref} data-testid={name}>
      <button type="button">{name} first</button>
      <button type="button">{name} last</button>
    </div>
  );
}

afterEach(cleanup);

describe('useModalLayer', () => {
  it('one Escape closes only the topmost layer', () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Layer name="bottom" onClose={closeBottom} />
        <Layer name="top" onClose={closeTop} />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it('Tab from the last control wraps to the first', () => {
    render(<Layer name="only" onClose={vi.fn()} />);
    const last = screen.getByText('only last');
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('only first'));
  });

  it('returns focus to the opener when the layer closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Layer name="x" onClose={vi.fn()} />);
    screen.getByText('x first').focus();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
