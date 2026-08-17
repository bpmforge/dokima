import { useState } from 'react';
import { ActiveBerthsStrip } from './ActiveBerthsStrip.js';
import {
  buildRunRefusalLine,
  fetchBuildRun,
  startBuildRun,
  type BuildRunOutcome,
} from './api.js';
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
  onViewCurrentPhase?: () => void;
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
  const [buildRun, setBuildRun] = useState<BuildRunOutcome | null>(null);
  const apiOpts = { baseUrl, token };

  /**
   * Poll the status route while a run is live. The outcome map behind it is
   * IN-MEMORY by design (W12-20) — a convenience for this poll, not a second
   * source of truth — so anything shown after a reload has to come from the
   * event log the trace route already serves rather than from here.
   */
  const handleStartRun = async () => {
    const started = await startBuildRun(apiOpts, projectId);
    if (!started.ok) {
      setBuildRun({
        runId: '—',
        status: 'refused',
        stderr: [started.problem.detail ?? 'could not start the run'],
      });
      return;
    }
    setBuildRun({ runId: started.data.runId, status: 'running' });
    for (let i = 0; i < 240; i++) {
      const polled = await fetchBuildRun(apiOpts, projectId, started.data.runId);
      if (!polled.ok) break;
      setBuildRun(polled.data);
      if (polled.data.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const refusalLine = buildRun ? buildRunRefusalLine(buildRun) : null;
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
      {/* W12-28: start the work from where the work is visible. The route
          existed (W12-20) and nothing called it, so the GUI could configure
          everything and start nothing. */}
      <div className="board-view__runbar" data-testid="board-runbar">
        <button
          type="button"
          disabled={buildRun?.status === 'running'}
          onClick={() => void handleStartRun()}
        >
          {buildRun?.status === 'running' ? 'Run in progress…' : 'Start a run'}
        </button>
        {buildRun && (
          <span data-testid="board-runbar-status">
            {buildRun.runId} — {buildRun.status}
          </span>
        )}
        {refusalLine && (
          <p role="alert" data-testid="board-runbar-refusal">
            {refusalLine}
          </p>
        )}
      </div>
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
