import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArtifactViewer } from './artifacts/ArtifactViewer.js';
import { BoardView } from './board/BoardView.js';
import { TicketDrawer } from './board/drawer/index.js';
import { ChatView } from './chat/ChatView.js';
import { readInjectedToken } from './chat/api.js';
import { FleetHome } from './fleet/FleetHome.js';
import { APP_NAME } from './index.js';
import { SplitPaneWorkspace } from './layout/SplitPaneWorkspace.js';
import { useReducedMotion } from './lib/useReducedMotion.js';
import { fetchNotifications } from './notifications/api.js';
import { NotificationsView } from './notifications/NotificationsView.js';
import './notifications/notifications.css';
import { CommandPalette } from './palette/index.js';
import type { PaletteMode } from './palette/index.js';
import { PlanView } from './plans/PlanView.js';
import './plans/plans.css';
import { RosterView } from './roster/RosterView.js';
import { FirstRunWizard } from './settings/FirstRunWizard.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { ShortcutsOverlay } from './shortcuts/ShortcutsOverlay.js';
import { ThemeProvider, useTheme } from './theme/ThemeProvider.js';
import { DrawerTraceLink } from './trace/DrawerTraceLink.js';
import { TraceView } from './trace/TraceView.js';
import { pushTraceViewUrl, readTraceTicketId } from './trace/urlParams.js';

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

type View = 'settings' | 'wizard' | 'roster' | 'notifications' | 'plans' | 'trace' | null;

/** `?project=`/`?view=` are the URL's source of truth (no router lib yet) — absent project means Fleet is the entry view (UX_SPEC §2); `view=settings`/`view=wizard`/`view=roster`/`view=notifications`/`view=plans`/`view=trace` layer over either Fleet or a project. */
function readProjectId(): string | null {
  return new URLSearchParams(window.location.search).get('project');
}

const VALID_VIEWS = ['settings', 'wizard', 'roster', 'notifications', 'plans', 'trace'];

function readView(): View {
  const view = new URLSearchParams(window.location.search).get('view');
  return view !== null && VALID_VIEWS.includes(view) ? (view as View) : null;
}

/** Live-update substitute for the header bell's Decide badge (WS push deferred, same precedent as `fleet/FleetHome.tsx`). */
const DECIDE_BADGE_POLL_MS = 5_000;

function useDecideBadgeCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetchNotifications({ tier: 'decide', status: 'open' })
        .then((items) => {
          if (!cancelled) setCount(items.length);
        })
        .catch(() => {
          if (!cancelled) setCount(0);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, DECIDE_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return count;
}

/**
 * `SplitPaneWorkspace` (W4-01) has no content-slot prop for its panes, and
 * `apps/web/src/layout/**` sits outside this ticket's write_scope — this
 * repo's own history (W4-01's gate-fix, docs/STATUS.md) establishes that
 * self-authorizing an out-of-scope edit is the wrong move; the fix is to
 * stop touching that file, not widen scope. A portal into its
 * already-rendered `pane-chat` DOM node mounts the chat workspace entirely from files this ticket *can* write.
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
 * Same portal pattern as `useChatPaneNode`, targeting the artifacts pane —
 * its actual, spec'd home (UX_SPEC §5: "Artifact Viewer + Receipt
 * Inspector (right pane)"). `EstimateWorkspace` (W4-08) portaled into this
 * same node as a stopgap because its real home, the Settings Matrix
 * (UX_SPEC §6), doesn't exist yet (W4-06, still `todo`); now that this pane
 * has its rightful content producer, the estimate portal is removed here —
 * see the W4-06 HANDOFF note in plan.json for where it needs to land next.
 * Server routes/engine and `EstimateWorkspace` itself are untouched, only
 * the mount moves.
 */
function useArtifactsPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-artifacts"]'));
  }, [projectId]);
  return node;
}

/**
 * Extracts a ticket id from a click that bubbled up from a `board-card`
 * (data-testid `card-{id}`, set by `board/Card.tsx` — outside this
 * ticket's write_scope). Event delegation on the portaled subtree is the
 * only way to hook a card click without editing `Card.tsx`/`BoardView.tsx`
 * directly, same "stop touching that file" discipline as this module's
 * other pane portals. Clicks on the card's own verb-menu `<select>` are
 * ignored so opening the drawer never fights the existing move-to menu.
 */
function ticketIdFromCardClick(event: React.MouseEvent<HTMLElement>): string | null {
  const target = event.target as HTMLElement;
  if (target.closest('select')) return null;
  const card = target.closest<HTMLElement>('[data-testid^="card-"]');
  if (!card) return null;
  const testId = card.getAttribute('data-testid');
  return testId ? testId.slice('card-'.length) : null;
}

function AppShell() {
  useReducedMotion();
  const [projectId, setProjectId] = useState<string | null>(() => readProjectId());
  const [view, setView] = useState<View>(() => readView());
  // Derived at render time, not mirrored into state (same "URL is the source of truth" discipline as readProjectId/readView).
  const traceTicketId = view === 'trace' ? readTraceTicketId() : null;
  const chatPaneNode = useChatPaneNode(projectId);
  const boardPaneNode = useBoardPaneNode(projectId);
  const artifactsPaneNode = useArtifactsPaneNode(projectId);
  const token = readInjectedToken();
  // Stable ref: TraceView's effects key off this by identity — an inline literal would refetch on every unrelated re-render.
  const apiOpts = useMemo(() => (token ? { baseUrl: '/api/v1', token } : null), [token]);
  const decideBadgeCount = useDecideBadgeCount();
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setProjectId(readProjectId());
      setView(readView());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openProject = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    url.searchParams.delete('view');
    window.history.pushState({}, '', url);
    setProjectId(id);
    setView(null);
  }, []);

  const backToFleet = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    url.searchParams.delete('view');
    window.history.pushState({}, '', url);
    setProjectId(null);
    setView(null);
  }, []);

  const openView = useCallback((next: Exclude<View, null>) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.pushState({}, '', url);
    setView(next);
  }, []);

  const closeView = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('ticket');
    window.history.pushState({}, '', url);
    setView(null);
  }, []);

  /** Opens the session-trace view for a ticket (BLUEPRINT §12.4) and closes any open drawer. */
  const openTraceView = useCallback((ticketId: string) => {
    pushTraceViewUrl(ticketId);
    setOpenTicketId(null);
    setView('trace');
  }, []);

  /**
   * Palette mode picker (UX_SPEC §2a "What are we doing today?"). New
   * Product / Onboard existing repo are real, already-wired flows — this
   * is just the fastest path to the same `FirstRunWizard` the header's
   * Settings entry already opens, so it drops any open project in one
   * history entry rather than two. Feature/Improve have no dispatcher
   * anywhere in this app yet (no chat-send endpoint exists —
   * `chat/fixtures.ts`'s module header — so there is nothing to send a
   * `/sdlc feature`/`/sdlc improve` command to); refusing to fabricate one,
   * this surfaces an honest notice instead (HANDOFF: a future chat-dispatch
   * ticket wires these two for real).
   */
  const onSelectPaletteMode = useCallback((mode: PaletteMode) => {
    if (mode === 'new' || mode === 'onboard') {
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      url.searchParams.set('view', 'wizard');
      window.history.pushState({}, '', url);
      setProjectId(null);
      setView('wizard');
      setModeNotice(null);
    } else {
      setModeNotice(
        `"${mode === 'feature' ? 'Feature' : 'Improve'}" isn't wired to a workflow dispatcher yet — no chat-send endpoint exists in this app to carry it.`,
      );
    }
  }, []);

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <span>{APP_NAME}</span>
        <div className="app-shell__header-actions">
          <nav className="app-shell__nav">
            {view && view !== 'settings' && view !== 'wizard' ? (
              <button type="button" onClick={closeView}>
                ← Back
              </button>
            ) : (
              <>
                <button type="button" onClick={() => openView('roster')}>
                  Roster
                </button>
                {projectId && (
                  <button type="button" onClick={() => openView('plans')}>
                    Plan
                  </button>
                )}
                <button
                  type="button"
                  className="app-shell__notifications-bell"
                  onClick={() => openView('notifications')}
                  aria-label={`Notifications, ${decideBadgeCount} awaiting a decision`}
                >
                  🔔
                  {decideBadgeCount > 0 && (
                    <span className="app-shell__decide-badge" data-testid="decide-badge">
                      {decideBadgeCount}
                    </span>
                  )}
                </button>
              </>
            )}
          </nav>
          <button type="button" onClick={() => openView('settings')}>
            Settings
          </button>
          <ThemeToggle />
        </div>
      </header>
      {view === 'roster' ? (
        <RosterView projectId={projectId} />
      ) : view === 'notifications' ? (
        <NotificationsView />
      ) : view === 'plans' && projectId ? (
        <PlanView projectId={projectId} />
      ) : view === 'trace' && projectId && apiOpts && traceTicketId ? (
        <TraceView
          apiOpts={apiOpts}
          projectId={projectId}
          ticketId={traceTicketId}
          onClose={closeView}
        />
      ) : view === 'wizard' ? (
        <FirstRunWizard
          onFinish={(createdProjectId) => {
            if (createdProjectId) {
              openProject(createdProjectId);
            } else {
              closeView();
            }
          }}
          onCancel={closeView}
        />
      ) : view === 'settings' ? (
        <SettingsPage
          projectId={projectId ?? undefined}
          onOpenWizard={() => openView('wizard')}
          onClose={closeView}
        />
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
              <div
                onClick={(event) => {
                  const ticketId = ticketIdFromCardClick(event);
                  if (ticketId) setOpenTicketId(ticketId);
                }}
              >
                <BoardView
                  baseUrl="/api/v1"
                  token={token}
                  projectId={projectId}
                  wsUrl={wsUrl()}
                  onViewCurrentPhase={() => openView('plans')}
                  onSelectTicket={setOpenTicketId}
                />
              </div>,
              boardPaneNode,
            )}
          {artifactsPaneNode &&
            token &&
            createPortal(
              <ArtifactViewer token={token} projectId={projectId} />,
              artifactsPaneNode,
            )}
          {token && (
            <CommandPalette
              baseUrl="/api/v1"
              token={token}
              projectId={projectId}
              onJumpToTicket={setOpenTicketId}
              onSelectMode={onSelectPaletteMode}
            />
          )}
          {token && openTicketId && (
            <TicketDrawer
              baseUrl="/api/v1"
              token={token}
              projectId={projectId}
              wsUrl={wsUrl()}
              ticketId={openTicketId}
              onClose={() => setOpenTicketId(null)}
            />
          )}
          <DrawerTraceLink ticketId={openTicketId} onOpenTrace={openTraceView} />
        </>
      ) : (
        <FleetHome onOpenProject={openProject} onOpenWizard={() => openView('wizard')} />
      )}
      {modeNotice && (
        <p className="app-shell__mode-notice" role="status" data-testid="mode-notice">
          {modeNotice}{' '}
          <button type="button" onClick={() => setModeNotice(null)}>
            Dismiss
          </button>
        </p>
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
