// @vitest-environment jsdom
/**
 * W10-34: the overlay had no scrim (page behind stayed full-brightness),
 * sat on top of the header at a fixed 5rem inset, and its shortcut list was
 * a static "?"/"Esc" pair that never mentioned ⌘K/Ctrl+K — wrong both where
 * the palette works (silent about a real shortcut) and where it doesn't
 * (Fleet, where ⌘K is inert and the overlay said nothing about that
 * either). These tests exercise the real DOM structure and the URL-driven
 * context switch, not just `shortcuts.ts`'s pure `shortcutsFor` (covered
 * separately in shortcuts.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsOverlay } from './ShortcutsOverlay.js';

function pressOpenKey() {
  fireEvent.keyDown(window, { key: '?' });
}

function pressEscape() {
  fireEvent.keyDown(window, { key: 'Escape' });
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('ShortcutsOverlay', () => {
  it('is hidden until "?" is pressed, and Escape still closes it', () => {
    render(<ShortcutsOverlay />);
    expect(screen.queryByTestId('shortcuts-overlay')).toBeNull();

    pressOpenKey();
    expect(screen.getByTestId('shortcuts-overlay')).toBeTruthy();

    pressEscape();
    expect(screen.queryByTestId('shortcuts-overlay')).toBeNull();
  });

  it('renders the panel inside a scrim backdrop', () => {
    render(<ShortcutsOverlay />);
    pressOpenKey();

    const backdrop = screen.getByTestId('shortcuts-overlay-backdrop');
    const panel = screen.getByTestId('shortcuts-overlay');
    expect(backdrop.contains(panel)).toBe(true);
  });

  // The palette now mounts on every screen, so the row is listed on every
  // screen — Fleet, an open project, and a project sub-view alike.
  it.each(['/', '/?project=proj-1', '/?project=proj-1&view=roster', '/?view=settings'])(
    'at %s, lists "?", Esc and the command-palette shortcut',
    (url) => {
      window.history.pushState({}, '', url);
      render(<ShortcutsOverlay />);
      pressOpenKey();

      expect(screen.getByText('Toggle this shortcuts overlay')).toBeTruthy();
      expect(screen.getByText('Close overlay / dismiss')).toBeTruthy();
      expect(
        screen.getByText('Open command palette (search and go anywhere)'),
      ).toBeTruthy();
    },
  );
});
