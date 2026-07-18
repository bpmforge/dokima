import './estimate.css';
import { EscalationRoiView } from './EscalationRoiView.js';
import { EstimateView } from './EstimateView.js';
import { WeeklyDigestCard } from './WeeklyDigestCard.js';

export interface EstimateWorkspaceProps {
  token: string;
  projectId: string;
}

/** Mounted under the Settings Matrix's "Cost Estimate" tab (UX_SPEC §6, SettingsPage.tsx) — the dry-run estimate, escalation-ROI view, and weekly digest card. */
export function EstimateWorkspace({ token, projectId }: EstimateWorkspaceProps) {
  return (
    <div className="estimate" data-testid="estimate-workspace">
      <EstimateView token={token} projectId={projectId} />
      <EscalationRoiView token={token} projectId={projectId} />
      <WeeklyDigestCard token={token} projectId={projectId} />
    </div>
  );
}
