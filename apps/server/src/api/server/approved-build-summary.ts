/**
 * What a build run is DOING, in words a person can act on (W23-14, AB-14).
 *
 * The board could say two things about a run: `running`, and a terminal
 * status. Everything between — the model is writing code, the checks are
 * running, a finding is being repaired, three tickets are waiting for you —
 * happened invisibly, and a person watching a spinner for forty minutes has no
 * way to tell work from a hang.
 *
 * DERIVED HERE, NOT IN THE BROWSER. The phase is a fold over the run's own
 * events, and the browser holds none of them; shipping the log to the client
 * so it could compute this would be a second implementation of the same
 * question and the two would disagree the first time either changed.
 *
 * A FAILURE IS NOT ONE OF THE SIX. AB-14 step 3 names Building, Checking,
 * Fixing, Ready to review, Needs your decision and Stopped, and a run that
 * refused or died is none of them: calling it stopped would say a person asked
 * for it, and calling it needs-decision would put it in a queue it does not
 * belong to. It gets its own word.
 */

import { listEvents, type EventLog } from '@dokima/events';
import {
  readBuildRunState,
  type BuildRunOutcomeKind,
} from './approved-build-run-state.js';

export type BuildPhase =
  | 'not_started'
  | 'building'
  | 'checking'
  | 'fixing'
  | 'ready_to_review'
  | 'needs_decision'
  | 'stopped'
  | 'failed';

export type TicketProgressState =
  'building' | 'landed' | 'checking' | 'fixing' | 'accepted' | 'needs_decision';

export interface TicketProgress {
  readonly ticketId: string;
  readonly state: TicketProgressState;
  /** Why it needs a person, when it does — the policy rule's own sentence. */
  readonly reason: string | null;
  /** The policy row that produced the decision, so two refusals never read the same. */
  readonly ruleId: string | null;
  readonly repairRounds: number;
}

export interface BuildRunSummary {
  readonly runId: string;
  readonly projectId: string;
  readonly approvedBuild: boolean;
  readonly phase: BuildPhase;
  /** One sentence naming what is happening and what it means for the person reading. */
  readonly detail: string;
  readonly outcome: BuildRunOutcomeKind | null;
  readonly stopRequested: boolean;
  readonly tickets: readonly TicketProgress[];
}

const PHASE_SENTENCE: Record<BuildPhase, string> = {
  not_started: 'nothing has started yet',
  building: 'the agent is writing code against a ticket',
  checking: 'the work landed and is being independently re-verified and reviewed',
  fixing: 'a review found something and the agent is repairing it',
  ready_to_review: 'every ticket this run landed was verified and accepted',
  needs_decision: 'the run finished its work and some tickets need your decision',
  stopped: 'the run stopped because someone asked it to',
  failed: 'the run did not finish — nobody asked it to stop',
};

interface Progress {
  state: TicketProgressState;
  reason: string | null;
  ruleId: string | null;
  repairRounds: number;
}

/**
 * The run's progress, folded from its own events. Returns undefined when this
 * run id was never started for this project — which the caller must keep
 * distinct from "it is not running".
 */
export function summarizeBuildRun(
  log: EventLog,
  runId: string,
): BuildRunSummary | undefined {
  const state = readBuildRunState(log, runId);
  if (!state) return undefined;

  const tickets = new Map<string, Progress>();
  const touch = (ticketId: string): Progress => {
    const existing = tickets.get(ticketId);
    if (existing) return existing;
    const fresh: Progress = {
      state: 'building',
      reason: null,
      ruleId: null,
      repairRounds: 0,
    };
    tickets.set(ticketId, fresh);
    return fresh;
  };

  /** The latest live activity, which is what "what is it doing NOW" means. */
  let livePhase: BuildPhase = 'building';
  for (const event of listEvents(log)) {
    if (event.runId !== runId || !event.ticketId) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const progress = touch(event.ticketId);
    switch (event.eventType) {
      case 'ticket.closed':
        progress.state = 'landed';
        livePhase = 'checking';
        break;
      case 'review.verdict':
      case 'review.skipped':
      case 'review.bounced':
        progress.state = 'checking';
        livePhase = 'checking';
        break;
      case 'build.repair.round':
        progress.state = 'fixing';
        progress.repairRounds += 1;
        livePhase = 'fixing';
        break;
      case 'ticket.accepted':
        progress.state = 'accepted';
        break;
      case 'build.accept.decided': {
        const accepted = payload.accepted === true;
        progress.state = accepted ? 'accepted' : 'needs_decision';
        progress.reason = typeof payload.reason === 'string' ? payload.reason : null;
        progress.ruleId = typeof payload.ruleId === 'string' ? payload.ruleId : null;
        break;
      }
      case 'ticket.claimed':
      case 'ticket.started':
        progress.state = 'building';
        livePhase = 'building';
        break;
      default:
        break;
    }
  }

  const phase = phaseFor(state.outcome, state.stopRequested, livePhase, tickets.size);
  return {
    runId,
    projectId: state.projectId,
    approvedBuild: state.approvedBuild,
    phase,
    detail: state.detail ?? PHASE_SENTENCE[phase],
    outcome: state.outcome,
    stopRequested: state.stopRequested,
    tickets: [...tickets.entries()].map(([ticketId, p]) => ({ ticketId, ...p })),
  };
}

function phaseFor(
  outcome: BuildRunOutcomeKind | null,
  stopRequested: boolean,
  livePhase: BuildPhase,
  ticketCount: number,
): BuildPhase {
  if (outcome === 'stopped' || (outcome === null && stopRequested)) return 'stopped';
  if (outcome === 'failed' || outcome === 'interrupted') return 'failed';
  if (outcome === 'awaiting_decision') return 'needs_decision';
  if (outcome === 'verified') return 'ready_to_review';
  return ticketCount === 0 ? 'not_started' : livePhase;
}

/** The sentence for a phase, for a caller that has a phase and no summary. */
export function phaseSentence(phase: BuildPhase): string {
  return PHASE_SENTENCE[phase];
}

/** Every build run this project has recorded, newest first. */
export function listBuildRuns(log: EventLog, projectId: string): readonly string[] {
  const ids: string[] = [];
  for (const event of listEvents(log)) {
    if (event.eventType !== 'build.run.started' || !event.runId) continue;
    const payload = (event.payload ?? {}) as { projectId?: unknown };
    if (payload.projectId !== projectId) continue;
    ids.push(event.runId);
  }
  return ids.reverse();
}
