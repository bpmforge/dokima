import { useCallback, useEffect, useMemo, useRef } from 'react';
import { explainRefusal } from '../refusal.js';
import { availableVerbsFrom, verbTargetColumn } from '../transitions.js';
import type { LifecycleVerb } from '../api.js';
import type { ContractTicket } from './types.js';
import { useBoardData } from '../useBoardData.js';
import './drawer.css';
import { ContractPanel } from './ContractPanel.js';
import { DagEditPanel } from './DagEditPanel.js';
import { EvidencePanel } from './EvidencePanel.js';
import { patchDependsOn } from './api.js';
import { TelemetryPanel } from './TelemetryPanel.js';

export interface TicketDrawerProps {
  baseUrl: string;
  token: string;
  projectId: string;
  wsUrl: string;
  ticketId: string;
  onClose: () => void;
}

/**
 * Board detail drawer (UX_SPEC §4, card click): full contract, history,
 * evidence, live telemetry, spend by rung, session-trace link, pre-build
 * DAG edit with explain-refusals. Reuses the exported `useBoardData` hook
 * (its own WS connection — `BoardView.tsx`/`Card.tsx` are outside this
 * ticket's write_scope, so there is no path to lift their already-fetched
 * state up into this independently-mounted drawer).
 */
export function TicketDrawer({
  baseUrl,
  token,
  projectId,
  wsUrl,
  ticketId,
  onClose,
}: TicketDrawerProps) {
  const { tickets, heartbeats, loading, refusal, dismissRefusal, fireVerb } =
    useBoardData({
      baseUrl,
      token,
      projectId,
      wsUrl,
    });
  const apiOpts = useMemo(() => ({ baseUrl, token }), [baseUrl, token]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submitDagEdit = useCallback(
    (dependsOn: string[]) => patchDependsOn(apiOpts, projectId, ticketId, dependsOn),
    [apiOpts, projectId, ticketId],
  );

  const ticket = tickets.find((t) => t.id === ticketId) as ContractTicket | undefined;

  return (
    <div className="ticket-drawer__backdrop" data-testid="ticket-drawer-backdrop">
      <div
        className="ticket-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={ticket ? `Ticket ${ticket.id} detail` : 'Ticket detail'}
        data-testid="ticket-drawer"
      >
        <header className="ticket-drawer__header">
          <h2>{ticket ? `${ticket.id} — ${ticket.title}` : ticketId}</h2>
          <button type="button" ref={closeButtonRef} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {loading && <p>Loading…</p>}
        {!loading && !ticket && <p data-testid="drawer-not-found">Ticket not found.</p>}

        {ticket && (
          <>
            {refusal && refusal.ticketId === ticket.id && (
              <p role="alert" data-testid="drawer-refusal">
                <strong>{explainRefusal(refusal.problem).rule}</strong>:{' '}
                {explainRefusal(refusal.problem).message}
                <button type="button" onClick={dismissRefusal}>
                  Dismiss
                </button>
              </p>
            )}

            <section aria-label="Quick actions">
              {availableVerbsFrom(ticket.status).map((verb) => (
                <button
                  key={verb}
                  type="button"
                  onClick={() => void fireVerb(ticket.id, verb as LifecycleVerb)}
                >
                  {verb} → {verbTargetColumn(verb)}
                </button>
              ))}
            </section>

            <ContractPanel ticket={ticket} />
            <EvidencePanel
              baseUrl={baseUrl}
              token={token}
              projectId={projectId}
              ticket={ticket}
            />
            <TelemetryPanel
              apiOpts={apiOpts}
              projectId={projectId}
              ticketId={ticket.id}
              heartbeat={heartbeats.get(ticket.id)}
            />

            {ticket.status === 'ready' && (
              <section aria-label="Pre-build DAG edit">
                <h3>Edit dependencies</h3>
                <DagEditPanel
                  key={ticket.id}
                  ticketId={ticket.id}
                  dependsOn={ticket.dependsOn}
                  allTickets={tickets}
                  onSubmit={submitDagEdit}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
