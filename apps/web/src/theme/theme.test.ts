import { describe, expect, it } from 'vitest';
import { nextTheme, resolveInitialTheme } from './theme.js';

describe('resolveInitialTheme', () => {
  it('honors an explicit stored choice over the system preference', () => {
    expect(resolveInitialTheme('light', true)).toBe('light');
    expect(resolveInitialTheme('dark', false)).toBe('dark');
  });

  it('falls back to prefers-color-scheme when nothing is stored', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme(null, false)).toBe('light');
  });

  it('ignores a corrupt stored value and falls back to the system preference', () => {
    expect(resolveInitialTheme('purple', true)).toBe('dark');
  });
});

describe('nextTheme', () => {
  it('toggles between light and dark', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});
