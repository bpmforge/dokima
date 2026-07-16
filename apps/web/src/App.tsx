import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardView } from './board/BoardView.js';
import { ChatView } from './chat/ChatView.js';
import { readInjectedToken } from './chat/api.js';
import { EstimateWorkspace } from './estimate/EstimateWorkspace.js';
import { FleetHome } from './fleet/FleetHome.js';
import { APP_NAME } from './index.js';
import { SplitPaneWorkspace } from './layout/SplitPaneWorkspace.js';
import { useReducedMotion } from './lib/useReducedMotion.js';
import { RosterView } from './roster/RosterView.js';
import { ShortcutsOverlay } from './shortcuts/ShortcutsOverlay.js';
import { ThemeProvider, useTheme } from './theme/ThemeProvider.js';

function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

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

/** `?view=roster` toggles the Agent Roster screen (SRS FR-E2, R-K1) — same URL-is-source-of-truth discipline as `?project=`, independent of it (Roster is reachable from Fleet or from within an open project). */
function readIsRosterView(): boolean {
  return new URLSearchParams(window.location.search).get('view') === 'roster';
}

/**
 * `SplitPaneWorkspace` (W4-01) has no content-slot prop for its panes, and
 * `apps/web/src/layout/**` sits outside this ticket's write_scope — this
 * repo's own history (W4-01's gate-fix, docs/STATUS.md) establishes that
 * self-authorizing an out-of-scope edit is the wrong move; the fix is to
 * stop touching that file, not widen scope. A portal into its
 * already-rendered `pane-chat` DOM node mounts the chat workspace entirely
 * from files this ticket *can* write.
 *
 * Re-queries whenever `projectId` changes rather than once on mount:
 * `SplitPaneWorkspace` (and its pane nodes) only exists in the DOM once a
 * project is open, so a mount-only query run while still on Fleet (the
 * common path — Fleet → click Open, no full page reload) would cache a
 * permanent `null` and never portal anything in.
 */
function useChatPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-chat"]'));
  }, [projectId]);
  return node;
}

/** Same portal pattern as `useChatPaneNode`, targeting the board pane (UX_SPEC §2a). */
function useBoardPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-board"]'));
  }, [projectId]);
  return node;
}

/**
 * Same portal pattern as `useChatPaneNode`, targeting the artifacts pane
 * (BLUEPRINT §12.2's dry-run estimate belongs under the Settings Matrix's
 * budget panel, UX_SPEC §6 — that screen doesn't exist yet, so the
 * estimate/escalation-ROI/weekly-digest workspace renders in the one pane
 * with no content producer yet, same discipline as the chat/board portals).
 */
function useArtifactsPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-artifacts"]'));
  }, [projectId]);
  return node;
}

function AppShell() {
  useReducedMotion();
  const [projectId, setProjectId] = useState<string | null>(() => readProjectId());
  const [isRosterView, setIsRosterView] = useState<boolean>(() => readIsRosterView());
  const chatPaneNode = useChatPaneNode(projectId);
  const boardPaneNode = useBoardPaneNode(projectId);
  const artifactsPaneNode = useArtifactsPaneNode(projectId);
  const token = readInjectedToken();

  useEffect(() => {
    const onPopState = () => {
      setProjectId(readProjectId());
      setIsRosterView(readIsRosterView());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openRoster = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'roster');
    window.history.pushState({}, '', url);
    setIsRosterView(true);
  }, []);

  const closeRoster = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.pushState({}, '', url);
    setIsRosterView(false);
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
        <nav className="app-shell__nav">
          {isRosterView ? (
            <button type="button" onClick={closeRoster}>
              ← Back
            </button>
          ) : (
            <button type="button" onClick={openRoster}>
              Roster
            </button>
          )}
        </nav>
        <ThemeToggle />
      </header>
      {isRosterView ? (
        <RosterView projectId={projectId} />
      ) : projectId ? (
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
          {boardPaneNode &&
            token &&
            createPortal(
              <BoardView
                baseUrl="/api/v1"
                token={token}
                projectId={projectId}
                wsUrl={wsUrl()}
              />,
              boardPaneNode,
            )}
          {artifactsPaneNode &&
            token &&
            createPortal(
              <EstimateWorkspace token={token} projectId={projectId} />,
              artifactsPaneNode,
            )}
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
