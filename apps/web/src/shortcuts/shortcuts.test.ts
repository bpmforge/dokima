import { describe, expect, it } from 'vitest';
import {
  isShortcutOverlayCloseKey,
  isShortcutOverlayOpenKey,
  shortcutsFor,
} from './shortcuts.js';

describe('isShortcutOverlayOpenKey', () => {
  it('opens on "?" when the target is not editable', () => {
    expect(isShortcutOverlayOpenKey({ key: '?', target: {} })).toBe(true);
    expect(isShortcutOverlayOpenKey({ key: '?', target: { tagName: 'DIV' } })).toBe(true);
  });

  it('ignores "?" while typing in an input/textarea/select', () => {
    expect(isShortcutOverlayOpenKey({ key: '?', target: { tagName: 'INPUT' } })).toBe(
      false,
    );
    expect(isShortcutOverlayOpenKey({ key: '?', target: { tagName: 'TEXTAREA' } })).toBe(
      false,
    );
    expect(isShortcutOverlayOpenKey({ key: '?', target: { tagName: 'SELECT' } })).toBe(
      false,
    );
  });

  it('ignores "?" inside a contenteditable element', () => {
    expect(
      isShortcutOverlayOpenKey({ key: '?', target: { isContentEditable: true } }),
    ).toBe(false);
  });

  it('ignores any other key', () => {
    expect(isShortcutOverlayOpenKey({ key: 'a', target: {} })).toBe(false);
  });
});

describe('isShortcutOverlayCloseKey', () => {
  it('closes on Escape', () => {
    expect(isShortcutOverlayCloseKey({ key: 'Escape' })).toBe(true);
    expect(isShortcutOverlayCloseKey({ key: 'a' })).toBe(false);
  });
});

describe('shortcutsFor (W10-34)', () => {
  it('always lists "?" and Esc', () => {
    const keys = shortcutsFor({ paletteActive: false }).map((s) => s.keys);
    expect(keys).toContain('?');
    expect(keys).toContain('Esc');
  });

  it('omits the command-palette shortcut where the palette is not mounted (Fleet, or a project sub-view)', () => {
    const shortcuts = shortcutsFor({ paletteActive: false });
    expect(shortcuts).toHaveLength(2);
    expect(shortcuts.some((s) => s.description === 'Open command palette')).toBe(false);
  });

  it('lists the command-palette shortcut where the palette is actually mounted', () => {
    const shortcuts = shortcutsFor({ paletteActive: true });
    expect(shortcuts).toHaveLength(3);
    expect(shortcuts).toContainEqual({
      keys: '⌘K / Ctrl+K',
      description: 'Open command palette',
    });
  });
});
