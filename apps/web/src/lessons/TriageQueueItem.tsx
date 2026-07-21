/**
 * One field report in the triage queue (BLUEPRINT §12.6: "triaged reports
 * become playbook entries or validator fixes"). Accept -> Playbook and
 * Accept -> Ticket each collect the extra fields their `TriageDecision`
 * variant needs before submitting; Reject needs none. The self-filed notice
 * is a UX nicety only — the server is the actual enforcement of "the filer
 * cannot triage their own report" (Law 5, `packages/memory/src/lessons/
 * triage.ts`'s `SelfTriageError`).
 */
import { type FormEvent, useState } from 'react';
import type { TriageDecision } from './api.js';
import type { FieldReportRecord } from './types.js';

export interface TriageQueueItemProps {
  report: FieldReportRecord;
  actorId: string;
  busy: boolean;
  error: string | null;
  onTriage: (decision: TriageDecision) => void | Promise<void>;
}

type Mode = 'idle' | 'playbook' | 'ticket';

export function TriageQueueItem({
  report,
  actorId,
  busy,
  error,
  onTriage,
}: TriageQueueItemProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [taskClass, setTaskClass] = useState('');
  const [entry, setEntry] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [title, setTitle] = useState(report.whatHappened);
  const [lane, setLane] = useState('');
  const [writeScope, setWriteScope] = useState('');

  const selfFiled = report.filedBy === actorId;

  const submitPlaybook = (e: FormEvent) => {
    e.preventDefault();
    if (!taskClass.trim() || !entry.trim()) return;
    void onTriage({
      decision: 'playbook',
      taskClass: taskClass.trim(),
      entry: entry.trim(),
    });
  };

  const submitTicket = (e: FormEvent) => {
    e.preventDefault();
    const scopeGlobs = writeScope
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!ticketId.trim() || !title.trim() || !lane.trim() || scopeGlobs.length === 0)
      return;
    void onTriage({
      decision: 'ticket',
      ticketId: ticketId.trim(),
      title: title.trim(),
      lane: lane.trim(),
      writeScope: scopeGlobs,
    });
  };

  return (
    <div className="triage-queue-item" data-testid={`triage-item-${report.id}`}>
      <p className="triage-queue-item__what">{report.whatHappened}</p>
      <p className="triage-queue-item__expected">
        <strong>Expected:</strong> {report.expected}
      </p>
      {report.evidenceLinks.length > 0 && (
        <ul className="triage-queue-item__evidence">
          {report.evidenceLinks.map((link) => (
            <li key={link}>{link}</li>
          ))}
        </ul>
      )}
      {selfFiled && (
        <p role="alert" data-testid={`triage-item-${report.id}-self-filed`}>
          You filed this report — triage requires a different reviewer (Law 5).
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      {mode === 'idle' && (
        <div className="triage-queue-item__actions">
          <button
            type="button"
            disabled={busy || selfFiled}
            onClick={() => setMode('playbook')}
          >
            Accept → Playbook
          </button>
          <button
            type="button"
            disabled={busy || selfFiled}
            onClick={() => setMode('ticket')}
          >
            Accept → Validator-fix ticket
          </button>
          <button
            type="button"
            disabled={busy || selfFiled}
            onClick={() => void onTriage({ decision: 'reject' })}
          >
            Reject
          </button>
        </div>
      )}

      {mode === 'playbook' && (
        <form onSubmit={submitPlaybook}>
          <label>
            Task class
            <input
              aria-label={`Task class for report ${report.id}`}
              value={taskClass}
              disabled={busy}
              onChange={(e) => setTaskClass(e.target.value)}
              required
            />
          </label>
          <label>
            Playbook entry
            <textarea
              aria-label={`Playbook entry for report ${report.id}`}
              value={entry}
              disabled={busy}
              onChange={(e) => setEntry(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy || !taskClass.trim() || !entry.trim()}>
            Confirm
          </button>
          <button type="button" disabled={busy} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'ticket' && (
        <form onSubmit={submitTicket}>
          <label>
            Ticket id
            <input
              aria-label={`Ticket id for report ${report.id}`}
              value={ticketId}
              disabled={busy}
              onChange={(e) => setTicketId(e.target.value)}
              required
            />
          </label>
          <label>
            Title
            <input
              aria-label={`Ticket title for report ${report.id}`}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label>
            Lane
            <input
              aria-label={`Ticket lane for report ${report.id}`}
              value={lane}
              disabled={busy}
              onChange={(e) => setLane(e.target.value)}
              required
            />
          </label>
          <label>
            Write scope (comma-separated globs)
            <input
              aria-label={`Ticket write scope for report ${report.id}`}
              value={writeScope}
              disabled={busy}
              onChange={(e) => setWriteScope(e.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            disabled={
              busy ||
              !ticketId.trim() ||
              !title.trim() ||
              !lane.trim() ||
              !writeScope.trim()
            }
          >
            Confirm
          </button>
          <button type="button" disabled={busy} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
