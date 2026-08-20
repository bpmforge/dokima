import type { ContractTicket } from './types.js';

export interface ContractPanelProps {
  ticket: ContractTicket;
}

/** Full contract + history timeline (UX_SPEC §4 detail drawer). */
export function ContractPanel({ ticket }: ContractPanelProps) {
  return (
    <section aria-label="Contract" data-testid="drawer-contract">
      <dl className="ticket-drawer__contract-grid">
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
        <dd>{ticket.dependsOn.length > 0 ? ticket.dependsOn.join(', ') : 'none'}</dd>
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
