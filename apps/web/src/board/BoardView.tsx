import { useState } from 'react';
import { ActiveBerthsStrip } from './ActiveBerthsStrip.js';
import {
  buildRunRefusalLine,
  fetchBuildRun,
  runOutcome,
  startBuildRun,
  stopBuildRun,
  type BuildRunOutcome,
} from './api.js';
import './board.css';
import { EmptyState } from './BoardEmptyState.js';
import { startOnboardAnalysis } from './api.js';
import { ClaimNowStrip } from './ClaimNowStrip.js';
import { openBlockers } from './badges.js';
import { groupIntoLanes } from './lanes.js';
import { Lane } from './Lane.js';
import { RefusalPopover } from './RefusalPopover.js';
import { RunSummary } from './RunSummary.js';
import { ShippedTicker } from './ShippedTickerStrip.js';
import { useBoardData } from './useBoardData.js';
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
  const [buildRun, setBuildRun] = useState<BuildRunOutcome | null>(null);
  const [stopping, setStopping] = useState(false);
  const apiOpts = { baseUrl, token };

  // W17-07: the way out the live UAT lacked. The loop stops at its next
  // ticket boundary; in-flight work finishes or parks honestly.
  // W17-10: the budget park's own fix, one click — write the raised project
  // setting, then start a run. Both effects are stated on the button.
  const handleRaiseBudgetRetry = async (_ticketId: string, newBudget: number) => {
    await putProjectSettings(projectId, { maxToolIterations: newBudget });
    await handleStartRun();
  };

  const handleStopRun = async () => {
    if (!buildRun || buildRun.status !== 'running') return;
    setStopping(true);
    await stopBuildRun(apiOpts, projectId, buildRun.runId);
  };

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
    /**
     * W21-82: the poll must never leave the board CLAIMING a run is live.
     *
     * This looped 240 times at one second, so any run longer than four
     * minutes fell out of the bottom with `buildRun` still at
     * `status: 'running'` — and `disabled={buildRun?.status === 'running'}`
     * then kept the button dead forever. A failed poll did the same thing one
     * line earlier, breaking without touching state at all.
     *
     * Live (Tally, run-mtbveccb): the run parked at 18:50:53 and the board
     * still read "Run in progress… run-mtbveccb — running" ten minutes later.
     * Clicking did nothing, because the click landed on a disabled button. A
     * page reload cleared it instantly, which is the tell: the run was over,
     * only this component's state said otherwise.
     *
     * Four minutes is not an edge case for the product's own target user — a
     * local model working a real ticket routinely runs longer, and every one
     * of this session's runs did.
     *
     * So: follow it for as long as a run plausibly lives, and on ANY exit
     * that is not a terminal status, drop back to idle rather than lie. The
     * outcome map behind this poll is in-memory by design (W12-20) and the
     * board's own ticket cards carry the durable truth, so idle is honest —
     * "this page is no longer following that run", not "it finished".
     */
    const MAX_POLLS = 4 * 60 * 60;
    for (let i = 0; i < MAX_POLLS; i++) {
      const polled = await fetchBuildRun(apiOpts, projectId, started.data.runId);
      if (!polled.ok) {
        setBuildRun(null);
        return;
      }
      setBuildRun(polled.data);
      if (polled.data.status !== 'running') return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    setBuildRun(null);
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
      return result.problem.detail ?? result.problem.title ?? 'the analysis could not run';
    };
    return <EmptyState onViewCurrentPhase={onViewCurrentPhase} onAnalyseRepository={analyse} />;
  }

  const lanes = groupIntoLanes(tickets);
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
        <button
          type="button"
          className="btn-primary"
          disabled={buildRun?.status === 'running'}
          onClick={() => {
            setStopping(false);
            void handleStartRun();
          }}
        >
          {buildRun?.status === 'running' ? 'Run in progress…' : 'Start a run'}
        </button>
        {buildRun?.status === 'running' && (
          <button
            type="button"
            className="btn-quiet"
            data-testid="board-runbar-stop"
            disabled={stopping}
            onClick={() => void handleStopRun()}
            title="The run stops at the next ticket boundary — work already in flight finishes or parks honestly."
          >
            {stopping ? 'Stopping at the next ticket…' : 'Stop the run'}
          </button>
        )}
        {/* W13-59: the novice's single next step was a bare button with an
            unstated consequence. One line: what a run is (VOCABULARY.md) and
            the wizard-standard reassurance about what it may use. */}
        <p className="board-view__run-hint" data-testid="board-runbar-hint">
          A run is one pass of the agent working the board: it claims Ready
          tickets, does the work, and hands back receipts. It uses only the
          models you chose in Settings → Models, within your Autonomy setting
          — nothing else is contacted.
        </p>
        {buildRun && (
          <span data-testid="board-runbar-status">
            {buildRun.runId} — {buildRun.status}
            {/* W13-63: "finished" alone read as success-toned nothing when a
                run parked its only ticket. The CLI already prints the
                outcome; the banner now carries it. */}
            {runOutcome(buildRun) !== null && ` · ${runOutcome(buildRun)}`}
          </span>
        )}
        {refusalLine && (
          <p role="alert" data-testid="board-runbar-refusal">
            {refusalLine}
          </p>
        )}
        {/* W19-04: once the run ends, one card says what it did — derived
            from the run's own event slice, nothing new to keep in sync. */}
        {buildRun && buildRun.status !== 'running' && (
          <RunSummary apiOpts={apiOpts} projectId={projectId} runId={buildRun.runId} />
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
