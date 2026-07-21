/**
 * Resolves the real actor a `trace`/`escalation`-sourced field report should
 * be `filedBy` — split out of `routes.ts` (book-style, CODE_BOOK_PROTOCOL.md)
 * since it is a self-contained concern: re-read the exact logged event a
 * `sourceRef` (`prefill.ts`'s `trace:<runId>:<seq>` /
 * `escalation:<ticketId>:<occurredAt>` shapes) points at, and return its
 * `actorId` — never trust the client's own account of who filed it. See
 * `routes.ts`'s header for why this is what makes the triage flow (accept-
 * to-playbook / accept-to-ticket / reject) reachable at all in production
 * (W7-05 conductor gate-fix).
 */
import { listEvents, type EventLog } from '@shipwright/events';
import type { FieldReportSource } from '@shipwright/memory';

/** `undefined` (caller falls back to `OPERATOR_ACTOR_ID`) for `source: 'manual'` or an unresolvable `sourceRef`. */
export function resolveFiledBy(
  log: EventLog,
  source: FieldReportSource,
  sourceRef: string | null,
): string | undefined {
  if (!sourceRef) return undefined;
  const events = listEvents(log);

  if (source === 'trace') {
    const parts = sourceRef.split(':');
    if (parts.length !== 3 || parts[0] !== 'trace') return undefined;
    const [, runId, seqRaw] = parts;
    const seq = Number(seqRaw);
    if (!Number.isInteger(seq)) return undefined;
    const match = events.find(
      (e) => e.seq === seq && (runId === 'unknown' || e.runId === runId),
    );
    return match?.actorId;
  }

  if (source !== 'escalation' || !sourceRef.startsWith('escalation:')) return undefined;
  const rest = sourceRef.slice('escalation:'.length);
  const sep = rest.indexOf(':');
  if (sep === -1) return undefined;
  const ticketId = rest.slice(0, sep);
  const occurredAt = rest.slice(sep + 1);
  const match = events.find(
    (e) =>
      e.ticketId === ticketId &&
      e.createdAt === occurredAt &&
      e.eventType.startsWith('escalation.'),
  );
  return match?.actorId;
}
