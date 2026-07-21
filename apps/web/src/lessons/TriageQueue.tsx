/**
 * Triage flow (BLUEPRINT §12.6): lists pending field reports and turns each
 * accepted one into a playbook entry or a validator-fix ticket, or rejects
 * it (`../lessons/api.ts`'s `triageFieldReport`).
 */
import { useCallback, useEffect, useState } from 'react';
import type { BoardApiOptions } from '../board/api.js';
import { listFieldReports, triageFieldReport, type TriageDecision } from './api.js';
import { TriageQueueItem } from './TriageQueueItem.js';
import type { FieldReportRecord } from './types.js';

export interface TriageQueueProps {
  apiOpts: BoardApiOptions;
  projectId: string;
  actorId: string;
}

export function TriageQueue({ apiOpts, projectId, actorId }: TriageQueueProps) {
  const [reports, setReports] = useState<FieldReportRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [decideErrors, setDecideErrors] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const result = await listFieldReports(apiOpts, projectId, 'pending');
    if (result.ok) {
      setReports(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.problem.detail || result.problem.title);
    }
  }, [apiOpts, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const triage = useCallback(
    async (reportId: number, decision: TriageDecision) => {
      setBusyId(reportId);
      setDecideErrors((prev) => ({ ...prev, [reportId]: '' }));
      try {
        const result = await triageFieldReport(apiOpts, projectId, reportId, decision);
        if (result.ok) {
          setReports((prev) => (prev ?? []).filter((r) => r.id !== reportId));
        } else {
          setDecideErrors((prev) => ({
            ...prev,
            [reportId]: result.problem.detail || result.problem.title,
          }));
        }
      } finally {
        setBusyId(null);
      }
    },
    [apiOpts, projectId],
  );

  if (loadError) return <p role="alert">{loadError}</p>;
  if (reports === null) return <p>Loading…</p>;
  if (reports.length === 0) {
    return (
      <p className="triage-queue__empty" role="status" data-testid="triage-queue-empty">
        No field reports awaiting triage.
      </p>
    );
  }

  return (
    <ul className="triage-queue" data-testid="triage-queue">
      {reports.map((report) => (
        <li key={report.id}>
          <TriageQueueItem
            report={report}
            actorId={actorId}
            busy={busyId === report.id}
            error={decideErrors[report.id] || null}
            onTriage={(decision) => triage(report.id, decision)}
          />
        </li>
      ))}
    </ul>
  );
}
