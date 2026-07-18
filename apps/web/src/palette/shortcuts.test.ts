import { describe, expect, it } from 'vitest';
import { isPaletteCloseKey, isPaletteOpenKey } from './shortcuts.js';

describe('isPaletteOpenKey', () => {
  it('fires on Cmd+K (mac)', () => {
    expect(isPaletteOpenKey({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true);
  });

  it('fires on Ctrl+K (windows/linux)', () => {
    expect(isPaletteOpenKey({ key: 'K', metaKey: false, ctrlKey: true })).toBe(true);
  });

  it('does not fire on plain "k"', () => {
    expect(isPaletteOpenKey({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false);
  });

  it('does not fire on an unrelated Cmd-modified key', () => {
    expect(isPaletteOpenKey({ key: 'j', metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe('isPaletteCloseKey', () => {
  it('fires on Escape', () => {
    expect(isPaletteCloseKey({ key: 'Escape' })).toBe(true);
  });

  it('does not fire on other keys', () => {
    expect(isPaletteCloseKey({ key: 'Enter' })).toBe(false);
  });
});
