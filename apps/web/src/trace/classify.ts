/**
 * Honest event categorization for the session-trace replay view
 * (BLUEPRINT §12.4: "prompt, tool calls, gate results per pass"). That
 * phrase is descriptive prose about the intended debugging surface, not a
 * schema — today's only real event producers are `ticket.*`
 * (`packages/tickets`) and `gate.*` (`packages/events/src/receipts.ts`);
 * `loop.pass`/`gateway.call_completed` exist only in test fixtures
 * (`apps/server/src/api/server/runs-routes.test.ts`). Classification is
 * prefix/shape-based (mirrors `apps/server/src/api/roster-history.ts`'s
 * `classify()`) so real events always land in a truthful bucket instead of
 * a fabricated one, and the moment a real `loop.pass`/tool-call producer
 * lands, its events classify correctly without touching this file.
 */

export type TraceEventKind =
  'pass' | 'tool_call' | 'gate' | 'escalation' | 'lifecycle' | 'other';

const PASS_EVENT_TYPES = new Set(['loop.pass']);
const TOOL_CALL_EVENT_TYPES = new Set(['gateway.call_completed']);
const GATE_PREFIX = 'gate.';
const ESCALATION_PREFIX = 'escalation.';
const LIFECYCLE_PREFIX = 'ticket.';

export function classifyTraceEvent(eventType: string): TraceEventKind {
  if (PASS_EVENT_TYPES.has(eventType)) return 'pass';
  if (TOOL_CALL_EVENT_TYPES.has(eventType)) return 'tool_call';
  if (eventType.startsWith(GATE_PREFIX)) return 'gate';
  if (eventType.startsWith(ESCALATION_PREFIX)) return 'escalation';
  if (eventType.startsWith(LIFECYCLE_PREFIX)) return 'lifecycle';
  return 'other';
}

export const TRACE_EVENT_KIND_LABEL: Record<TraceEventKind, string> = {
  pass: 'Pass',
  tool_call: 'Tool call',
  gate: 'Gate result',
  escalation: 'Escalation',
  lifecycle: 'Ticket lifecycle',
  other: 'Event',
};

/** `payload.pass` when present (a `loop.pass` shape) — grouping hint only, never assumed present. */
export function passNumber(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  return typeof record.pass === 'number' ? record.pass : null;
}

/**
 * Human sentence for a known event type (W13-60). The trace is the screen a
 * novice opens to understand what a run did, and it labelled rows with raw
 * wire identifiers ('gate.receipt_minted', 'escalation.rung_advanced') that
 * VOCABULARY.md never defines. The wire id stays on the row as secondary
 * detail — renaming the wire itself would be a migration, and the rename-in-
 * the-UI-only rule (VOCABULARY.md) forbids that. Unknown types fall back to
 * the kind label, never to an invented sentence.
 */
const TRACE_EVENT_HUMAN: Record<string, string> = {
  'loop.pass': 'The run made a pass over the ticket',
  'gateway.call_completed': 'A model answered a request',
  'gate.receipt_minted': 'A gate checked the work and minted a receipt',
  'gate.waived': 'A person waived a gate',
  'escalation.rung_advanced': 'Escalated to a stronger model',
  'escalation.blocked':
    'Escalation stopped — the ladder has no stronger model to climb to',
  'ticket.created': 'The ticket was created',
  'ticket.claimed': 'The ticket was claimed',
  'ticket.started': 'Work started on the ticket',
  'ticket.closed': 'The ticket was closed with a Completion Manifest',
  'ticket.accepted': 'The work was accepted',
  'ticket.released': 'The ticket was released back to Ready',
  'ticket.commented': 'A comment was added to the ticket',
  // W16-08: the W16 loops' own events, in plain words — before this they
  // fell into the generic "Event" bucket (milder than W13-60's raw wire
  // ids, but still nothing a person could read). Mechanism-true, wire ids
  // stay as the secondary detail line.
  'playbook.r0_hit': 'Memory already held a verified answer for this task',
  'playbook.r0_miss': 'Memory was checked first and had no answer',
  'forge.issue_mapped': 'A mirrored issue was created on the forge',
  'forge.mirror_written': 'A ticket update was mirrored to the forge',
  'forge.mirror_queued': 'The forge was unreachable — the update is queued to send later',
  'forge.mirror_flushed': 'A queued update reached the forge',
  'berths.ticket_admitted': 'A worker picked up the ticket',
  'memory.consolidated': 'The run’s lessons were consolidated into memory',
  'memory.hook_failed': 'A memory step failed and was recorded — the run continued',
  'session.infra_retry':
    'The model endpoint failed — retried without spending an attempt',
  'sandbox.waived': 'A person allowed this run to verify without a sandbox',
};

export function describeTraceEvent(eventType: string): string {
  return (
    TRACE_EVENT_HUMAN[eventType] ?? TRACE_EVENT_KIND_LABEL[classifyTraceEvent(eventType)]
  );
}

/**
 * 'rung' defined at first encounter (VOCABULARY.md's rule for load-bearing
 * internal terms): shown as a title/tooltip on the escalation detail.
 */
export const RUNG_DEFINITION =
  'A rung is one step on the ladder of models — runs start on the cheapest rung and climb one step at a time when work stalls.';
