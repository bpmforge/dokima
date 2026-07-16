import './estimate.css';
import { EscalationRoiView } from './EscalationRoiView.js';
import { EstimateView } from './EstimateView.js';
import { WeeklyDigestCard } from './WeeklyDigestCard.js';

export interface EstimateWorkspaceProps {
  token: string;
  projectId: string;
}

/**
 * Portals into the artifacts pane (`App.tsx`, same pattern
 * `ChatView`/`BoardView` use for the chat/board panes) — the Settings
 * Matrix's budget panel this belongs under (UX_SPEC §6) has no screen of
 * its own yet, so the dry-run estimate, escalation-ROI view, and weekly
 * digest card render here until that lands.
 */
export function EstimateWorkspace({ token, projectId }: EstimateWorkspaceProps) {
  return (
    <div className="estimate" data-testid="estimate-workspace">
      <EstimateView token={token} projectId={projectId} />
      <EscalationRoiView token={token} projectId={projectId} />
      <WeeklyDigestCard token={token} projectId={projectId} />
    </div>
  );
}
