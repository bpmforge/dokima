import { APP_NAME } from '../index.js';
import { useReducedMotion } from '../lib/useReducedMotion.js';
import { ShortcutsOverlay } from '../shortcuts/ShortcutsOverlay.js';
import { useApiBootstrap, useDecideBadgeCount } from './bootstrap.js';
import { AppHeader } from './Header.js';
import { MainView } from './MainView.js';
import { useAppNavigation } from './navigation.js';
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
  const chatPaneNode = useChatPaneNode(projectId);
  const boardPaneNode = useBoardPaneNode(projectId);
  const artifactsPaneNode = useArtifactsPaneNode(projectId);
  const { token, apiOpts, wsUrl } = useApiBootstrap();
  const decideBadgeCount = useDecideBadgeCount();

  return (
    <div className="app-shell">
      <AppHeader
        appName={APP_NAME}
        view={view}
        projectId={projectId}
        decideBadgeCount={decideBadgeCount}
        openView={openView}
        closeView={closeView}
      />
      <MainView
        view={view}
        projectId={projectId}
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
        onSelectPaletteMode={onSelectPaletteMode}
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
