import { blockedExplanation } from '../badges.js';
import { COLUMN_LABEL } from '../transitions.js';
import type { ContractTicket } from './types.js';

export interface ContractPanelProps {
  ticket: ContractTicket;
  /** Unfinished dependencies, for saying why a blocked ticket waits. */
  blockers?: readonly string[];
  /** Opens a dependency in the drawer; without it ids render as text. */
  onOpenTicket?: (ticketId: string) => void;
}

/** Full contract + history timeline (UX_SPEC §4 detail drawer). */
export function ContractPanel({ ticket, blockers, onOpenTicket }: ContractPanelProps) {
  return (
    <section aria-label="Contract" data-testid="drawer-contract">
      <dl className="ticket-drawer__contract-grid">
        <dt>State</dt>
        <dd data-testid="drawer-state">
          {COLUMN_LABEL[ticket.status] ?? ticket.status}
          {ticket.status === 'blocked' && (
            <p className="ticket-drawer__blocked-why">{blockedExplanation(blockers ?? [])}</p>
          )}
        </dd>
        <dt>Lane</dt>
        <dd>{ticket.lane}</dd>
        <dt>Owner</dt>
        <dd>{ticket.ownerId ?? 'unclaimed'}</dd>
        <dt>Write scope</dt>
        <dd>
          {ticket.writeScope && ticket.writeScope.length > 0 ? (
            <ul>
              {ticket.writeScope.map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                </li>
              ))}
            </ul>
          ) : (
            'unknown (not on this response)'
          )}
        </dd>
        <dt>Depends on</dt>
        <dd data-testid="drawer-depends-on">
          {ticket.dependsOn.length === 0
            ? 'none'
            : ticket.dependsOn.map((id, index) => (
                <span key={id}>
                  {index > 0 && ', '}
                  {onOpenTicket ? (
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => onOpenTicket(id)}
                      aria-label={`Open ticket ${id}`}
                    >
                      {id}
                    </button>
                  ) : (
                    id
                  )}
                </span>
              ))}
        </dd>
      </dl>

      <h3>Acceptance</h3>
      {ticket.acceptance.length === 0 ? (
        <p className="ticket-drawer__empty">No acceptance criteria yet — planning writes them when the ticket is created, and agents refuse to close a ticket that has none.</p>
      ) : (
        <ul className="ticket-drawer__acceptance">
          {ticket.acceptance.map((criterion) => (
            <li key={criterion.id}>
              <span aria-hidden="true">{criterion.done ? '✅' : '⬜'}</span>{' '}
              <span className="sr-only">{criterion.done ? 'Done: ' : 'Not done: '}</span>
              {criterion.text}
            </li>
          ))}
        </ul>
      )}

      <h3>History</h3>
      {ticket.history.length === 0 ? (
        <p className="ticket-drawer__empty">No history yet — every claim, comment, close, and accept lands here the moment it happens.</p>
      ) : (
        <ol className="ticket-drawer__history" data-testid="drawer-history">
          {ticket.history.map((entry, index) => (
            <li key={`${entry.verb}-${entry.at}-${index}`}>
              <strong>{entry.verb}</strong> by {entry.actorId} · {entry.at}
              {entry.body && <p>{entry.body}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
