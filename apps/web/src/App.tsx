import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatView } from './chat/ChatView.js';
import { readInjectedToken } from './chat/api.js';
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

/**
 * `SplitPaneWorkspace` (W4-01) has no content-slot prop for its panes, and
 * `apps/web/src/layout/**` sits outside this ticket's write_scope — this
 * repo's own history (W4-01's gate-fix, docs/STATUS.md) establishes that
 * self-authorizing an out-of-scope edit is the wrong move; the fix is to
 * stop touching that file, not widen scope. A portal into its
 * already-rendered `pane-chat` DOM node mounts the chat workspace entirely
 * from files this ticket *can* write.
 */
function useChatPaneNode(): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-chat"]'));
  }, []);
  return node;
}

function AppShell() {
  useReducedMotion();
  const [projectId, setProjectId] = useState<string | null>(() => readProjectId());
  const chatPaneNode = useChatPaneNode();
  const token = readInjectedToken();

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
          {chatPaneNode &&
            token &&
            createPortal(<ChatView token={token} projectId={projectId} />, chatPaneNode)}
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
