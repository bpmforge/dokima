import { useState } from 'react';
import { ActiveBerthsStrip } from './ActiveBerthsStrip.js';
import './board.css';
import { EmptyState } from './BoardEmptyState.js';
import { startOnboardAnalysis } from './api.js';
import { ClaimNowStrip } from './ClaimNowStrip.js';
import { openBlockers } from './badges.js';
import { BoardFilterBar } from './BoardFilterBar.js';
import { countByFilter, filterTickets } from './boardFilter.js';
import { groupIntoLanes } from './lanes.js';
import { Lane } from './Lane.js';
import { RefusalPopover } from './RefusalPopover.js';
import { ApprovedBuildPanel } from './ApprovedBuildPanel.js';
import { ShippedTicker } from './ShippedTickerStrip.js';
import { BoardLoadError, NO_MODEL_REASON, NoModelReason } from './BoardNotices.js';
import { useBoardData } from './useBoardData.js';
import { useRunReadiness } from './useRunReadiness.js';
import { useBoardFilter } from './useBoardFilter.js';
import { putProjectSettings } from '../settings/api.js';

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
  // Brad's decision (2026-10-15): ONE way to start work. "Start a run" opens
  // the approved-run preview; nothing builds until the person approves it.
  // Bumping this asks the panel to open that preview (the budget-park retry).
  const [previewRequest, setPreviewRequest] = useState(0);
  const apiOpts = { baseUrl, token };
  const [filter, setFilter] = useBoardFilter(projectId);

  const { runLimitUsd, budgetStatus, noModel } = useRunReadiness(
    baseUrl,
    token,
    projectId,
  );

  // W17-10: the budget park's own fix, one click — write the raised project
  // setting, then show the run preview for approval. Both effects are stated
  // on the button.
  const handleRaiseBudgetRetry = async (_ticketId: string, newBudget: number) => {
    await putProjectSettings(projectId, { maxToolIterations: newBudget });
    setPreviewRequest((n) => n + 1);
  };

  const {
    tickets,
    heartbeats,
    loading,
    loadError,
    retryLoad,
    refusal,
    dismissRefusal,
    fireVerb,
    handleDrop,
    announcement,
  } = useBoardData({
    baseUrl,
    token,
    projectId,
    runId,
    wsUrl,
  });

  /**
   * W21-88: a VISIBLE loading state, not a blank screen.
   *
   * This returned `null`, so opening a project painted nothing at all until
   * the board data arrived — and the filed report ("a click on Start a run is
   * silently discarded") turns out to be the shape of that: the button does
   * not exist yet, so a click aimed where it will be lands on nothing. A
   * person cannot click a button they cannot see, which is why the filed
   * mechanism — an element replaced between the click and the handler — is not
   * what happened. The clicks that missed were coordinate-targeted ones from
   * an automated driver, and the ticket's own note suspected exactly that.
   *
   * The real defect is the one acceptance 2 names: nothing on screen says the
   * product is working. A blank panel and a swallowed click produce the same
   * conclusion in the same person — "this is broken" — which is why this is
   * worth fixing even though the click was never lost.
   */
  if (loading) {
    return (
      <div className="board-view" data-testid="board-view-loading">
        <p className="board-view__loading">Loading the board…</p>
      </div>
    );
  }
  if (loadError !== null && tickets.length === 0) {
    return <BoardLoadError message={loadError} onRetry={retryLoad} />;
  }
  if (tickets.length === 0) {
    /**
     * W21-95: the empty board offers the analysis the product already has.
     *
     * The refusal is returned rather than thrown so the panel can print it.
     * A problem response here is the honest answer to "why is my board still
     * empty" — most often no model configured for the analysis role — and
     * swallowing it would leave the board looking exactly as it did before,
     * which is the defect this replaces.
     */
    const analyse = async (): Promise<string | undefined> => {
      const result = await startOnboardAnalysis(apiOpts, projectId);
      // Nothing to refresh on success: `useBoardData` is websocket-driven, so
      // the tickets the analysis proposes arrive on the live projection and
      // this panel unmounts when the board stops being empty.
      if (result.ok) return undefined;
      return (
        result.problem.detail ?? result.problem.title ?? 'the analysis could not run'
      );
    };
    return (
      <EmptyState onViewCurrentPhase={onViewCurrentPhase} onAnalyseRepository={analyse} />
    );
  }

  // Filtering keeps the lanes × columns layout: a lane with no matching card
  // is dropped, every remaining lane keeps all of its columns.
  const lanes = groupIntoLanes(filterTickets(tickets, filter));
  const blockedDeps = new Map(
    tickets
      .filter((t) => t.status === 'blocked')
      .map((t) => [t.id, openBlockers(t, tickets)] as const),
  );
  const refusalTicket = refusal
    ? tickets.find((t) => t.id === refusal.ticketId)
    : undefined;

  return (
    <div className="board-view" data-testid="board-view">
      {/* W12-28: start the work from where the work is visible. The route
          existed (W12-20) and nothing called it, so the GUI could configure
          everything and start nothing. */}
      <div className="board-view__runbar" data-testid="board-runbar">
        {noModel && <NoModelReason projectId={projectId} />}
        {/* W23-14 + the 2026-10-15 merge of the two entry points: the
            approved run IS the run. It owns start, preview, stop, progress
            and the summary. */}
        <ApprovedBuildPanel
          apiOpts={apiOpts}
          projectId={projectId}
          budgetUsd={runLimitUsd}
          budgetStatus={budgetStatus}
          noModelReason={noModel ? NO_MODEL_REASON : null}
          onSelectTicket={onSelectTicket}
          previewRequest={previewRequest}
        />
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
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="board-announcer"
      >
        {announcement}
      </p>
      {refusal && refusalTicket && (
        <RefusalPopover
          ticketId={refusal.ticketId}
          problem={refusal.problem}
          onDismiss={dismissRefusal}
        />
      )}
      <BoardFilterBar
        filter={filter}
        counts={countByFilter(tickets)}
        onChange={setFilter}
      />
      {lanes.length === 0 && (
        <p className="board-view__filter-empty" data-testid="board-filter-empty">
          No cards match this filter.{' '}
          <button type="button" className="btn-quiet" onClick={() => setFilter('all')}>
            Show all
          </button>
        </p>
      )}
      <div className="board-view__lanes">
        {lanes.map((lane) => (
          <Lane
            key={lane.lane}
            lane={lane}
            heartbeats={heartbeats}
            blockedDeps={blockedDeps}
            onDrop={handleDrop}
            onFireVerb={(ticketId, verb) => void fireVerb(ticketId, verb)}
            onRaiseBudgetRetry={(ticketId, newBudget) =>
              void handleRaiseBudgetRetry(ticketId, newBudget)
            }
          />
        ))}
      </div>
    </div>
  );
}
