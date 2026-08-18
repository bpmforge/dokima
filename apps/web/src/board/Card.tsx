import type { DragEvent } from 'react';
import {
  isStaleBlocked,
  isWaived,
  STALE_BADGE_LABEL,
  WAIVED_BADGE_LABEL,
} from './badges.js';
import type { LifecycleVerb } from './api.js';
import { formatHeartbeat } from './heartbeat.js';
import { availableVerbsFrom, verbTargetColumn } from './transitions.js';
import type { BoardTicket, HeartbeatData } from './types.js';

export interface CardProps {
  ticket: BoardTicket;
  heartbeat?: HeartbeatData;
  onDragStart: (event: DragEvent<HTMLDivElement>, ticketId: string) => void;
  onFireVerb: (ticketId: string, verb: LifecycleVerb) => void;
}

const TYPE_LABEL: Record<BoardTicket['type'], string> = {
  epic: 'Epic',
  story: 'Story',
  task: 'Task',
  bug: 'Bug',
};

/**
 * Ticket card (UX_SPEC §4): id, title, owner chip, receipt dot (green =
 * close receipt exists), heartbeat freshness, stale/waived badges. Every
 * verb a drag could fire is also offered as a menu action (WCAG 2.2 AA —
 * "every drag has a verb equivalent").
 */
export function Card({ ticket, heartbeat, onDragStart, onFireVerb }: CardProps) {
  const verbs = availableVerbsFrom(ticket.status);
  return (
    <div
      className="board-card surface"
      data-testid={`card-${ticket.id}`}
      draggable
      onDragStart={(event) => onDragStart(event, ticket.id)}
      role="listitem"
      aria-label={`Ticket ${ticket.id}, ${ticket.status}, lane ${ticket.lane}${
        ticket.ownerId ? `, owned by ${ticket.ownerId}` : ''
      }`}
    >
      <header className="board-card__header">
        <span className="board-card__type">{TYPE_LABEL[ticket.type]}</span>
        <span className="board-card__id">{ticket.id}</span>
      </header>
      <p className="board-card__title">{ticket.title}</p>
      <div className="board-card__meta">
        <span className="board-card__owner">{ticket.ownerId ?? 'unclaimed'}</span>
        <span
          className="board-card__receipt-dot"
          data-state={ticket.manifest?.closeReceipt ? 'green' : 'none'}
          aria-label={
            ticket.manifest?.closeReceipt ? 'close receipt on file' : 'no receipt yet'
          }
        >
          {ticket.manifest?.closeReceipt ? '●' : '○'}
        </span>
      </div>
      {heartbeat && <p className="board-card__heartbeat">{formatHeartbeat(heartbeat)}</p>}
      {isStaleBlocked(ticket) && (
        <p className="board-card__badge board-card__badge--stale">{STALE_BADGE_LABEL}</p>
      )}
      {isWaived(ticket) && (
        <p className="board-card__badge board-card__badge--waived">
          {WAIVED_BADGE_LABEL}
        </p>
      )}
      {verbs.length > 0 && (
        <label className="board-card__verb-menu">
          <span className="sr-only">Move ticket {ticket.id}</span>
          <select
            value=""
            onChange={(event) => {
              const verb = event.target.value as LifecycleVerb;
              if (verb) onFireVerb(ticket.id, verb);
            }}
          >
            <option value="" disabled>
              Move to…
            </option>
            {verbs.map((verb) => (
              <option key={verb} value={verb}>
                {verb} → {verbTargetColumn(verb)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
