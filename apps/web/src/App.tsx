import { APP_NAME } from './index.js';
import { useReducedMotion } from './lib/useReducedMotion.js';
import { ShortcutsOverlay } from './shortcuts/ShortcutsOverlay.js';
import { ThemeProvider, useTheme } from './theme/ThemeProvider.js';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}

function AppShell() {
  useReducedMotion();
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <span>{APP_NAME}</span>
        <ThemeToggle />
      </header>
      <ShortcutsOverlay />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
