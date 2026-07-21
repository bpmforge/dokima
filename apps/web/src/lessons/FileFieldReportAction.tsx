/**
 * The "File field report" action (UX_SPEC §7 G-10c: "every session-trace
 * view and every escalation event card carries a 'File field report'
 * action"). Self-contained — a button that reveals the pre-filled form and
 * posts it — so it can be dropped onto either surface with just a `draft`
 * built by `prefill.ts`'s `draftFromTraceEvent`/`draftFromEscalationEvent`.
 * Mounted onto both session-trace rows and escalation event cards in
 * `TelemetryPanel.tsx` (write_scope widened to `apps/web/src/board/drawer/
 * TelemetryPanel.tsx` for exactly this wiring, plan.json W7-05 notes).
 */
import { useState } from 'react';
import type { BoardApiOptions } from '../board/api.js';
import { fileFieldReport } from './api.js';
import { FieldReportForm } from './FieldReportForm.js';
import type { FieldReportDraft, FieldReportRecord } from './types.js';

export interface FileFieldReportActionProps {
  apiOpts: BoardApiOptions;
  projectId: string;
  draft: FieldReportDraft;
  onFiled?: (record: FieldReportRecord) => void;
}

export function FileFieldReportAction({
  apiOpts,
  projectId,
  draft,
  onFiled,
}: FileFieldReportActionProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (finalDraft: FieldReportDraft) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await fileFieldReport(apiOpts, projectId, finalDraft);
      if (result.ok) {
        setOpen(false);
        onFiled?.(result.data);
      } else {
        setError(result.problem.detail || result.problem.title);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="file-field-report-action"
        onClick={() => setOpen(true)}
      >
        File field report
      </button>
    );
  }

  return (
    <div className="file-field-report-action" data-testid="file-field-report-panel">
      <FieldReportForm
        initialDraft={draft}
        onSubmit={submit}
        onCancel={() => setOpen(false)}
        submitting={submitting}
        error={error}
      />
    </div>
  );
}
