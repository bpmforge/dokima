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

  it('on the Fleet screen (no ?project=), lists "?" and Esc but not the inert palette shortcut', () => {
    render(<ShortcutsOverlay />);
    pressOpenKey();

    expect(screen.getByText('Toggle this shortcuts overlay')).toBeTruthy();
    expect(screen.getByText('Close overlay / dismiss')).toBeTruthy();
    expect(screen.queryByText('Open command palette')).toBeNull();
  });

  it('inside an open project, lists the command-palette shortcut too', () => {
    window.history.pushState({}, '', '/?project=proj-1');
    render(<ShortcutsOverlay />);
    pressOpenKey();

    expect(screen.getByText('Open command palette')).toBeTruthy();
  });

  it('in a project sub-view (palette unmounted, e.g. Roster), omits the palette shortcut again', () => {
    window.history.pushState({}, '', '/?project=proj-1&view=roster');
    render(<ShortcutsOverlay />);
    pressOpenKey();

    expect(screen.queryByText('Open command palette')).toBeNull();
  });
});
