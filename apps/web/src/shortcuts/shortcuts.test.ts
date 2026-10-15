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

describe('shortcutsFor', () => {
  it('lists "?", Esc and the command palette — the palette is mounted on every screen', () => {
    const shortcuts = shortcutsFor();
    expect(shortcuts.map((s) => s.keys)).toEqual(['?', 'Esc', '⌘K / Ctrl+K']);
  });
});
