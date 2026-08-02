/** Pure theme-resolution logic (modern-product baseline: dark/light + system, W4-01). */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dokima.theme';

/** First paint: explicit user choice wins; otherwise follow the OS (`prefers-color-scheme`). */
export function resolveInitialTheme(
  stored: string | null,
  systemPrefersDark: boolean,
): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}
