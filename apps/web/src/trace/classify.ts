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
