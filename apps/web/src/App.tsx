import { APP_NAME } from './index.js';
import { SplitPaneWorkspace } from './layout/SplitPaneWorkspace.js';
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

/** Fleet (W4-02) supplies the real project id; a `?project=` override keeps this ticket's layout-persistence testable ahead of it. */
function readProjectId(): string {
  return new URLSearchParams(window.location.search).get('project') ?? 'default';
}

function AppShell() {
  useReducedMotion();
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <span>{APP_NAME}</span>
        <ThemeToggle />
      </header>
      <SplitPaneWorkspace projectId={readProjectId()} />
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
