/**
 * Per-agent history projection (SRS FR-E2 "per-agent history queried from
 * events: HANDOFFs run, outcomes, verdict scores, spend, escalations").
 * A real `@shipwright/events` `Projection<S>` (docs/DATABASE.md §3's "pure
 * fold from the log") so `GET /roster/:agent/history` and the
 * incremental-equals-rebuild property test both fold the exact same
 * reducer over the exact same events — the test only proves something
 * about the endpoint if they share this one definition.
 *
 * No producer anywhere in this repo yet emits `escalation.*` events into a
 * project's real event log (`packages/gateway/src/escalation/events.ts`'s
 * own header: "events are minted here and handed to a caller-supplied sink
 * wired to the real event log elsewhere" — that wiring doesn't exist), and
 * no producer emits verdict-score or spend events at all. The `kind`
 * classification below is forward-compatible with those event types
 * (matching `escalation.rung_advanced`/`escalation.blocked` verbatim, plus
 * a `cost_usd`/`spend_usd` payload-shape heuristic for spend) so history
 * fills in the moment a real producer lands, without touching this file —
 * today those buckets are honestly empty (C-1), never fabricated.
 * `ticket.*` events (the one real producer, `packages/tickets`) are the
 * current stand-in for "HANDOFFs run" (claimed/started) and "outcomes"
 * (closed/accepted/released).
 */

import { rebuildProjection, type EventRecord, type Projection } from '@shipwright/events';

export type RosterHistoryKind =
  'handoff' | 'outcome' | 'verdict' | 'spend' | 'escalation' | 'other';

export interface RosterHistoryEntry {
  readonly seq: number;
  readonly eventType: string;
  readonly kind: RosterHistoryKind;
  readonly ticketId: string | null;
  readonly occurredAt: string;
  readonly payload: unknown;
}

export type RosterHistoryState = ReadonlyMap<string, readonly RosterHistoryEntry[]>;

const HANDOFF_EVENT_TYPES = new Set(['ticket.claimed', 'ticket.started']);
const OUTCOME_EVENT_TYPES = new Set([
  'ticket.closed',
  'ticket.accepted',
  'ticket.released',
]);

function hasSpendShape(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return typeof record.cost_usd === 'number' || typeof record.spend_usd === 'number';
}

function classify(eventType: string, payload: unknown): RosterHistoryKind {
  if (HANDOFF_EVENT_TYPES.has(eventType)) return 'handoff';
  if (OUTCOME_EVENT_TYPES.has(eventType)) return 'outcome';
  if (eventType.startsWith('escalation.')) return 'escalation';
  if (eventType.startsWith('fitness.') || eventType.includes('verdict')) return 'verdict';
  if (hasSpendShape(payload)) return 'spend';
  return 'other';
}

/** Folds the log into per-actor history — actorId is the agent/role attribution (board-actor.ts's OPERATOR_ACTOR_ID is the one actor real ticket verbs record today; a HANDOFF session attributing actorId=role is what populates a real expert's row). */
export const rosterHistoryProjection: Projection<RosterHistoryState> = {
  name: 'roster-history',
  initial: () => new Map<string, readonly RosterHistoryEntry[]>(),
  reduce(state, event: EventRecord): RosterHistoryState {
    const entry: RosterHistoryEntry = {
      seq: event.seq,
      eventType: event.eventType,
      kind: classify(event.eventType, event.payload),
      ticketId: event.ticketId,
      occurredAt: event.createdAt,
      payload: event.payload,
    };
    const next = new Map(state);
    next.set(event.actorId, [...(next.get(event.actorId) ?? []), entry]);
    return next;
  },
};

export interface AgentHistory {
  readonly agentId: string;
  readonly entries: readonly RosterHistoryEntry[];
  readonly handoffsRun: number;
  readonly outcomes: number;
  readonly verdictScores: number;
  readonly spend: number;
  readonly escalations: number;
}

export function summarizeAgentHistory(
  agentId: string,
  state: RosterHistoryState,
): AgentHistory {
  const entries = state.get(agentId) ?? [];
  const count = (kind: RosterHistoryKind) =>
    entries.filter((e) => e.kind === kind).length;
  return {
    agentId,
    entries,
    handoffsRun: count('handoff'),
    outcomes: count('outcome'),
    verdictScores: count('verdict'),
    spend: count('spend'),
    escalations: count('escalation'),
  };
}

/** Rebuild-from-zero for one agent — the single code path the endpoint and the rebuild-property test both call. */
export function buildAgentHistory(
  events: readonly EventRecord[],
  agentId: string,
): AgentHistory {
  const state = rebuildProjection(events, rosterHistoryProjection);
  return summarizeAgentHistory(agentId, state);
}
