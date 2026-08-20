import { useEffect, useState } from 'react';
import { fetchBoardTickets } from '../board/api.js';
import type { BoardTicket } from '../board/types.js';
import { readInjectedToken } from '../fleet/api.js';

/**
 * The work behind a Decide card, ON the card (W13-61, novice audit
 * CRITICAL).
 *
 * The queue asked a novice to approve or reject merging a branch while
 * showing a title and a diff-stat string — no files, no verify result, no
 * receipt, no way to look before answering. "Budget ten minutes to review a
 * night's work" is hollow if the review cannot see the work.
 *
 * Evidence comes from the ticket the card references — the manifest the
 * agent returned and the close gate verified (SC-02: the changed-file list
 * is the VERIFIED one, never self-reported). A card whose ticket cannot be
 * loaded says so and tells the reader where to look, rather than offering a
 * decision on nothing.
 */
export interface TicketEvidenceProps {
  projectId: string;
  ticketId: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'loaded'; ticket: BoardTicket };

export function TicketEvidence({ projectId, ticketId }: TicketEvidenceProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchBoardTickets(
          { baseUrl: '/api/v1', token: readInjectedToken() ?? '' },
          projectId,
        );
        if (cancelled) return;
        const ticket = result.ok ? result.data.find((t) => t.id === ticketId) : undefined;
        setState(ticket ? { kind: 'loaded', ticket } : { kind: 'missing' });
      } catch {
        if (!cancelled) setState({ kind: 'missing' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, ticketId]);

  if (state.kind === 'loading') {
    return <p className="notification-card__evidence">Loading the work…</p>;
  }
  if (state.kind === 'missing') {
    return (
      <p className="notification-card__evidence" data-testid={`evidence-missing-${ticketId}`}>
        The referenced ticket could not be loaded — open the project's board and
        review it there before deciding.
      </p>
    );
  }

  const { ticket } = state;
  const manifest = ticket.manifest;
  return (
    <div className="notification-card__evidence" data-testid={`evidence-${ticketId}`}>
      {manifest ? (
        <>
          <p>
            <strong>{manifest.files.length}</strong> file
            {manifest.files.length === 1 ? '' : 's'} changed · verify{' '}
            <code>{manifest.verify.command}</code>{' '}
            <span
              className={`state ${manifest.verify.exitCode === 0 ? 'state--running' : 'state--refused'}`}
            >
              {manifest.verify.exitCode === 0 ? 'passed' : `failed (exit ${manifest.verify.exitCode})`}
            </span>
            {manifest.closeReceipt ? ' · receipt on file' : ' · no receipt'}
          </p>
          <ul className="notification-card__evidence-files">
            {manifest.files.slice(0, 6).map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
            {manifest.files.length > 6 && (
              <li>… and {manifest.files.length - 6} more (open the ticket for all)</li>
            )}
          </ul>
        </>
      ) : (
        <p>
          This ticket has no Completion Manifest — the agent has not handed
          work back yet. There is nothing to approve; check the ticket's
          comments for what happened.
        </p>
      )}
    </div>
  );
}
