import { ActiveBerthsStrip } from './ActiveBerthsStrip.js';
import './board.css';
import { EmptyState } from './BoardEmptyState.js';
import { ClaimNowStrip } from './ClaimNowStrip.js';
import { groupIntoLanes } from './lanes.js';
import { Lane } from './Lane.js';
import { RefusalPopover } from './RefusalPopover.js';
import { ShippedTicker } from './ShippedTickerStrip.js';
import { useBoardData } from './useBoardData.js';

export interface BoardViewProps {
  baseUrl: string;
  token: string;
  projectId: string;
  runId?: string;
  wsUrl: string;
  /** Required, not optional (W10-33): UX_SPEC §2b's board-empty link and §4's shipped-ticker link must always be wired — a caller that forgets fails typecheck instead of shipping a dead control. */
  onViewCurrentPhase: () => void;
  onSelectTicket: (ticketId: string) => void;
}

/** Kanban board (UX_SPEC §4, FR-C4/FR-T4) — lanes x columns over live projections. */
export function BoardView({
  baseUrl,
  token,
  projectId,
  runId,
  wsUrl,
  onViewCurrentPhase,
  onSelectTicket,
}: BoardViewProps) {
  const { tickets, heartbeats, loading, refusal, dismissRefusal, fireVerb, handleDrop } =
    useBoardData({
      baseUrl,
      token,
      projectId,
      runId,
      wsUrl,
    });

  if (loading) return null;
  if (tickets.length === 0) return <EmptyState onViewCurrentPhase={onViewCurrentPhase} />;

  const lanes = groupIntoLanes(tickets);
  const refusalTicket = refusal
    ? tickets.find((t) => t.id === refusal.ticketId)
    : undefined;

  return (
    <div className="board-view" data-testid="board-view">
      <div className="board-view__strips">
        <ClaimNowStrip
          tickets={tickets}
          onClaim={(ticketId) => void fireVerb(ticketId, 'claim')}
        />
        <ActiveBerthsStrip heartbeats={heartbeats} />
        <ShippedTicker
          tickets={tickets}
          now={new Date()}
          onSelectTicket={onSelectTicket}
        />
      </div>
      {refusal && refusalTicket && (
        <RefusalPopover
          ticketId={refusal.ticketId}
          problem={refusal.problem}
          onDismiss={dismissRefusal}
        />
      )}
      <div className="board-view__lanes">
        {lanes.map((lane) => (
          <Lane
            key={lane.lane}
            lane={lane}
            heartbeats={heartbeats}
            onDrop={handleDrop}
            onFireVerb={(ticketId, verb) => void fireVerb(ticketId, verb)}
          />
        ))}
      </div>
    </div>
  );
}
