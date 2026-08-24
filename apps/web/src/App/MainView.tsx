import { createPortal } from 'react-dom';
import { ArtifactViewer } from '../artifacts/ArtifactViewer.js';
import { BoardView } from '../board/BoardView.js';
import { TicketDrawer } from '../board/drawer/index.js';
import { ChatView } from '../chat/ChatView.js';
import { DecisionsBoard } from '../decisions/DecisionsBoard.js';
import { FleetHome } from '../fleet/FleetHome.js';
import { SplitPaneWorkspace } from '../layout/SplitPaneWorkspace.js';
import { NotificationsView } from '../notifications/NotificationsView.js';
import '../notifications/notifications.css';
import { CommandPalette } from '../palette/index.js';
import type { PaletteMode } from '../palette/index.js';
import { InterviewPanel } from '../onboarding/InterviewPanel.js';
import { PlanView } from '../plans/PlanView.js';
import '../plans/plans.css';
import { RosterView } from '../roster/RosterView.js';
import { TeamViewRoot } from '../team/TeamViewRoot.js';
import { FirstRunWizard } from '../settings/FirstRunWizard.js';
import { SettingsPage } from '../settings/SettingsPage.js';
import { DrawerTraceLink } from '../trace/DrawerTraceLink.js';
import { TraceView } from '../trace/TraceView.js';
import { ticketIdFromCardClick } from './boardDelegation.js';
import type { ApiOpts } from './bootstrap.js';
import type { View } from './navigation.js';

interface MainViewProps {
  view: View;
  projectId: string | null;
  apiOpts: ApiOpts | null;
  traceTicketId: string | null;
  token: string | undefined;
  wsUrl: string;
  chatPaneNode: HTMLElement | null;
  boardPaneNode: HTMLElement | null;
  artifactsPaneNode: HTMLElement | null;
  openTicketId: string | null;
  setOpenTicketId: (id: string | null) => void;
  openProject: (id: string) => void;
  backToFleet: () => void;
  openView: (next: Exclude<View, null>) => void;
  closeView: () => void;
  openTraceView: (ticketId: string) => void;
  onSelectPaletteMode: (mode: PaletteMode) => void;
}

/** Per-view prop wiring chapter: the view ? ... : ... composition that used to live inline in AppShell. */
export function MainView({
  view,
  projectId,
  apiOpts,
  traceTicketId,
  token,
  wsUrl,
  chatPaneNode,
  boardPaneNode,
  artifactsPaneNode,
  openTicketId,
  setOpenTicketId,
  openProject,
  backToFleet,
  openView,
  closeView,
  openTraceView,
  onSelectPaletteMode,
}: MainViewProps) {
  if (view === 'roster') {
    return <RosterView projectId={projectId} />;
  }
  // W20-02: who is working right now, as opposed to who CAN work (roster).
  if (view === 'team' && projectId && apiOpts) {
    return (
      <TeamViewRoot
        projectId={projectId}
        baseUrl={apiOpts.baseUrl}
        token={apiOpts.token}
        wsUrl={wsUrl}
        onOpenDecisions={() => openView('decisions')}
      />
    );
  }
  if (view === 'notifications') {
    return <NotificationsView />;
  }
  if (view === 'plans' && projectId) {
    return <PlanView projectId={projectId} />;
  }
  // W10-54: the entry point that did not exist. Everything downstream — the
  // blueprint phase, decomposition, the board — was already built and reachable
  // only from the guided sample's hardcoded idea.
  if (view === 'interview' && projectId) {
    return (
      <InterviewPanel
        projectId={projectId}
        projectName={'Untitled'}
        onComplete={closeView}
        token={token}
      />
    );
  }
  // W10-72: the surface W5-14 built and nothing ever mounted. A creation run
  // paused on a founder decision answers its slates inline (see
  // `InterviewPanel`); this is the standalone entry, for slates raised outside
  // one and for coming back to a decision later.
  if (view === 'decisions' && projectId && token) {
    return <DecisionsBoard projectId={projectId} token={token} />;
  }
  if (view === 'trace' && projectId && apiOpts && traceTicketId) {
    return (
      <TraceView
        apiOpts={apiOpts}
        projectId={projectId}
        ticketId={traceTicketId}
        onClose={closeView}
      />
    );
  }
  if (view === 'wizard') {
    return (
      <FirstRunWizard
        // W13-35: lets step 2 actually register, instead of deferring every
        // registration to the sample-project step a user may decline.
        projectId={projectId}
        onFinish={(createdProjectId) => {
          if (createdProjectId) {
            openProject(createdProjectId);
          } else {
            closeView();
          }
        }}
        onCancel={closeView}
      />
    );
  }
  if (view === 'settings') {
    return (
      <SettingsPage
        projectId={projectId ?? undefined}
        onOpenWizard={() => openView('wizard')}
        onClose={closeView}
      />
    );
  }
  if (projectId) {
    return (
      <>
        <button type="button" className="app-shell__back-to-fleet" onClick={backToFleet}>
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
                wsUrl={wsUrl}
                onSelectTicket={setOpenTicketId}
                // W10-56: was `openView('plans')` — the Improvement Plan screen,
                // a different feature. Describing the product is what fills a board.
                onViewCurrentPhase={() => openView('interview')}
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
            wsUrl={wsUrl}
            ticketId={openTicketId}
            onClose={() => setOpenTicketId(null)}
          />
        )}
        <DrawerTraceLink ticketId={openTicketId} onOpenTrace={openTraceView} />
      </>
    );
  }
  return (
    <FleetHome
      onOpenProject={openProject}
      onOpenGuidedSample={() => openView('wizard')}
    />
  );
}
