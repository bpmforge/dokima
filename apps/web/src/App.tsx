import { useCallback, useEffect, useState } from 'react';
import { FleetHome } from './fleet/FleetHome.js';
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

/** `?project=` is the URL's source of truth (no router lib yet) — absent means Fleet is the entry view (UX_SPEC §2). */
function readProjectId(): string | null {
  return new URLSearchParams(window.location.search).get('project');
}

function AppShell() {
  useReducedMotion();
  const [projectId, setProjectId] = useState<string | null>(() => readProjectId());

  useEffect(() => {
    const onPopState = () => setProjectId(readProjectId());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openProject = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    window.history.pushState({}, '', url);
    setProjectId(id);
  }, []);

  const backToFleet = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    window.history.pushState({}, '', url);
    setProjectId(null);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <span>{APP_NAME}</span>
        <ThemeToggle />
      </header>
      {projectId ? (
        <>
          <button
            type="button"
            className="app-shell__back-to-fleet"
            onClick={backToFleet}
          >
            ← Fleet
          </button>
          <SplitPaneWorkspace projectId={projectId} />
        </>
      ) : (
        <FleetHome onOpenProject={openProject} />
      )}
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
