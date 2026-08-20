import type { DragEvent } from 'react';
import {
  blockedExplanation,
  cardStateClass,
  isParked,
  isStaleBlocked,
  isWaived,
  PARKED_BADGE_LABEL,
  STALE_BADGE_LABEL,
  WAIVED_BADGE_LABEL,
} from './badges.js';
import type { LifecycleVerb } from './api.js';
import { formatHeartbeat } from './heartbeat.js';
import { availableVerbsFrom, verbMenuLabel } from './transitions.js';
import type { BoardTicket, HeartbeatData } from './types.js';

export interface CardProps {
  ticket: BoardTicket;
  heartbeat?: HeartbeatData;
  /** Unfinished dependency ids for a blocked ticket (W13-60). */
  blockers?: readonly string[];
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
export function Card({ ticket, heartbeat, blockers, onDragStart, onFireVerb }: CardProps) {
  const verbs = availableVerbsFrom(ticket.status);
  return (
    <div
      className={`board-card surface${cardStateClass(ticket.status)}${
        isParked(ticket) ? ' surface--blocked' : ''
      }`}
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
      {/* W13-52: the chip gets its OWN row — both the header (opacity .7) and
          the meta row (opacity .8) deliberately recede, and axe measured the
          warning hue blended below WCAG contrast inside each (3.54, then
          2.94). State must never recede; the stale/waived badges already
          made the same choice. */}
      {ticket.status === 'blocked' && (
        <>
          <p className="board-card__state-row">
            <span className="state state--blocked">blocked</span>
          </p>
          {/* W13-60: blocked has no exit verb BY DESIGN (reflow auto-resolves
              it), so without this sentence the state was a dead end — no Move
              menu, every drag animates back, nothing says the wait is
              automatic or what it waits on. */}
          <p
            className="board-card__blocked-why"
            data-testid={`blocked-why-${ticket.id}`}
          >
            {blockedExplanation(blockers ?? [])}
          </p>
        </>
      )}
      {/* W13-63: a park RELEASES to Ready on purpose, so without this row the
          run's outcome was invisible — a novice watched a run finish and saw
          nothing happen. Warning family: stuck, not wrong. */}
      {isParked(ticket) && (
        <p className="board-card__state-row">
          <span className="state state--blocked">parked</span>
        </p>
      )}
      <div className="board-card__meta">
        <span className="board-card__owner">{ticket.ownerId ?? 'unclaimed'}</span>
        <span
          className="board-card__receipt-dot"
          data-state={ticket.manifest?.closeReceipt ? 'green' : 'none'}
          aria-label={
            ticket.manifest?.closeReceipt ? 'close receipt on file' : 'no receipt yet'
          }
          /* W13-52 (UX_AUDIT A-4): the dot was an unexplained glyph to anyone
             not using a screen reader — the meaning is now hover-discoverable. */
          title={
            ticket.manifest?.closeReceipt ? 'close receipt on file' : 'no receipt yet'
          }
        >
          {ticket.manifest?.closeReceipt ? '●' : '○'}
        </span>
      </div>
      {heartbeat && <p className="board-card__heartbeat">{formatHeartbeat(heartbeat)}</p>}
      {isParked(ticket) && (
        <p className="board-card__badge board-card__badge--stale">{PARKED_BADGE_LABEL}</p>
      )}
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
                {verbMenuLabel(verb)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
