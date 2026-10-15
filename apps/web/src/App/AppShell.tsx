import { APP_NAME } from '../index.js';
import { useCallback } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion.js';
import { CommandPalette, type PaletteNavTarget } from '../palette/index.js';
import { ShortcutsOverlay } from '../shortcuts/ShortcutsOverlay.js';
import { useApiBootstrap, useDecideBadgeCount } from './bootstrap.js';
import { AppHeader } from './Header.js';
import { MainView } from './MainView.js';
import { useAppNavigation } from './navigation.js';
import { useProjectName } from './projectName.js';
import { useArtifactsPaneNode, useBoardPaneNode, useChatPaneNode } from './paneNodes.js';

export function AppShell() {
  useReducedMotion();
  const {
    projectId,
    view,
    traceTicketId,
    openTicketId,
    setOpenTicketId,
    modeNotice,
    setModeNotice,
    openProject,
    backToFleet,
    openView,
    closeView,
    openTraceView,
    onSelectPaletteMode,
  } = useAppNavigation();
  // W10-61: no projectId argument — these re-query on every render because the
  // pane nodes are destroyed and recreated whenever MainView swaps to a
  // full-screen view and back, which projectId does not observe.
  const chatPaneNode = useChatPaneNode();
  const boardPaneNode = useBoardPaneNode();
  const artifactsPaneNode = useArtifactsPaneNode();
  const { token, apiOpts, wsUrl } = useApiBootstrap();
  const decideBadgeCount = useDecideBadgeCount();
  const projectName = useProjectName(projectId);

  // The palette lives here, not inside the project canvas, so ⌘K answers on
  // every screen. A ticket picked from a sub-view (Plan, Team, …) returns to
  // the board first, because the drawer it opens belongs to the board.
  const jumpToTicket = useCallback(
    (ticketId: string) => {
      if (view !== null) closeView();
      setOpenTicketId(ticketId);
    },
    [view, closeView, setOpenTicketId],
  );
  const navigate = useCallback(
    (target: PaletteNavTarget) => {
      if (target.kind === 'fleet') backToFleet();
      else if (target.kind === 'board') closeView();
      else if (target.kind === 'project') openProject(target.projectId);
      else openView(target.view);
    },
    [backToFleet, closeView, openProject, openView],
  );

  return (
    <div className="app-shell">
      {/* Review UX-12: a skip link and a <main> landmark — there was neither. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppHeader
        appName={APP_NAME}
        projectName={projectName}
        view={view}
        projectId={projectId}
        decideBadgeCount={decideBadgeCount}
        openView={openView}
        closeView={closeView}
      />
      <main id="main" className="app-shell__main" tabIndex={-1}>
        <MainView
          view={view}
          projectId={projectId}
          projectName={projectName}
          apiOpts={apiOpts}
          traceTicketId={traceTicketId}
          token={token}
          wsUrl={wsUrl}
          chatPaneNode={chatPaneNode}
          boardPaneNode={boardPaneNode}
          artifactsPaneNode={artifactsPaneNode}
          openTicketId={openTicketId}
          setOpenTicketId={setOpenTicketId}
          openProject={openProject}
          backToFleet={backToFleet}
          openView={openView}
          closeView={closeView}
          openTraceView={openTraceView}
        />
      </main>
      <CommandPalette
        baseUrl="/api/v1"
        token={token}
        projectId={projectId}
        onJumpToTicket={jumpToTicket}
        onSelectMode={onSelectPaletteMode}
        onNavigate={navigate}
      />
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
