import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArmedButton } from '../lib/ArmedButton.js';
import {
  blockedExplanation,
  budgetParkRetry,
  cardStateClass,
  isParked,
  parkSummary,
  isStaleBlocked,
  isWaived,
  PARKED_BADGE_LABEL,
  STALE_BADGE_LABEL,
  WAIVED_BADGE_LABEL,
} from './badges.js';
import type { LifecycleVerb } from './api.js';
import { consumeCardFocus, requestCardFocus } from './focusRequest.js';
import { formatHeartbeat, isHeartbeatStale } from './heartbeat.js';
import { useHeartbeatClock } from './useLiveRun.js';
import { availableVerbsFrom, verbMenuLabel } from './transitions.js';
import type { BoardTicket, HeartbeatData } from './types.js';

export interface CardProps {
  ticket: BoardTicket;
  heartbeat?: HeartbeatData;
  /** Unfinished dependency ids for a blocked ticket (W13-60). */
  blockers?: readonly string[];
  onDragStart: (event: DragEvent<HTMLDivElement>, ticketId: string) => void;
  onFireVerb: (ticketId: string, verb: LifecycleVerb) => void;
  /** W17-10: offered only on BUDGET parks — writes the raised setting, then starts a run. */
  onRaiseBudgetRetry?: (ticketId: string, newBudget: number) => void;
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
export function Card({
  ticket,
  heartbeat,
  blockers,
  onDragStart,
  onFireVerb,
  onRaiseBudgetRetry,
}: CardProps) {
  const verbs = availableVerbsFrom(ticket.status);
  // Review R1/R2: a live line's age ticks, and a silent one says so.
  const now = useHeartbeatClock(heartbeat !== undefined);
  const [chosen, setChosen] = useState<Exclude<LifecycleVerb, 'comment'> | ''>('');
  const openRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Take focus back after a move remounted this card in its new column.
  useEffect(() => {
    if (consumeCardFocus(ticket.id)) openRef.current?.focus();
  }, [ticket.id, ticket.status]);

  // Choosing in the menu only selects; the Move button fires. A select that
  // fired on change moved tickets on a stray ArrowDown (WCAG 3.2.2).
  const fire = () => {
    if (!chosen) return;
    if (cardRef.current?.contains(document.activeElement)) requestCardFocus(ticket.id);
    setChosen('');
    onFireVerb(ticket.id, chosen);
  };

  return (
    <div
      className={`board-card surface${cardStateClass(ticket.status)}${
        isParked(ticket) ? ' surface--blocked' : ''
      }`}
      ref={cardRef}
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
      <p className="board-card__title">
        {/* The keyboard way into the ticket drawer; the click bubbles to the
            board's card delegation like any other click on the card. */}
        <button
          type="button"
          ref={openRef}
          className="board-card__open"
          data-testid={`open-${ticket.id}`}
          aria-label={`Open ticket ${ticket.id}: ${ticket.title}`}
        >
          {ticket.title}
        </button>
      </p>
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
      {/* W17-07: the park worn on the face — count + the one-line why, so
          the evidence is a glance rather than a dig through comments. */}
      {(() => {
        const park = parkSummary(ticket);
        const retry = budgetParkRetry(ticket);
        return park ? (
          <>
            <p
              className="board-card__blocked-why"
              data-testid={`park-why-${ticket.id}`}
              title={park.fullReason}
            >
              {park.count > 1 ? `Parked ${park.count} times. ` : ''}
              {park.reason}
            </p>
            {/* W17-10: the evidence names the fix; this is the fix, one
                click, both effects stated before it (W13-61). */}
            {retry && onRaiseBudgetRetry && (
              <button
                type="button"
                className="btn-quiet"
                data-testid={`raise-retry-${ticket.id}`}
                title={`Writes this project's turn budget to ${retry.suggested}, then starts a run — nothing else changes.`}
                onClick={() => onRaiseBudgetRetry(ticket.id, retry.suggested)}
              >
                Raise the budget to {retry.suggested} and retry
              </button>
            )}
          </>
        ) : null;
      })()}
      <div className="board-card__meta">
        {/* W17-07: plain words for who has it; the raw actor id stays as the
            hover detail (VOCABULARY.md rename-in-UI-only). */}
        <span
          className="board-card__owner"
          title={ticket.ownerId ?? undefined}
          data-testid={`owner-${ticket.id}`}
        >
          {ticket.status === 'in_progress' && ticket.ownerId
            ? 'an agent is working this'
            : (ticket.ownerId ?? 'unclaimed')}
        </span>
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
      {heartbeat && (
        <p
          className="board-card__heartbeat"
          data-testid={`card-heartbeat-${ticket.id}`}
          data-stale={isHeartbeatStale(heartbeat, now) ? 'true' : undefined}
        >
          {formatHeartbeat(heartbeat, now)}
        </p>
      )}
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
        <div className="board-card__verb-menu">
          <label>
            <span className="sr-only">Move ticket {ticket.id}</span>
            <select
              value={chosen}
              onChange={(event) =>
                setChosen(event.target.value as Exclude<LifecycleVerb, 'comment'> | '')
              }
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
          {chosen === 'accept' ? (
            <ArmedButton
              label="Move"
              armedLabel="Accept as Done? This can't be undone. Click again"
              onConfirm={fire}
              className="btn-quiet"
              testId={`move-${ticket.id}`}
            />
          ) : (
            <button
              type="button"
              className="btn-quiet"
              data-testid={`move-${ticket.id}`}
              disabled={!chosen}
              onClick={fire}
            >
              Move
            </button>
          )}
        </div>
      )}
    </div>
  );
}
