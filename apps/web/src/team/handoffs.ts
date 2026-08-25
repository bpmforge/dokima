/**
 * Handoffs — work moving between people (W20-04).
 *
 * The pipeline already hands off; nothing new is recorded here. This module
 * reads the events that ALREADY exist and phrases them as moments naming both
 * people, so a founder can see the relay instead of inferring it from status
 * changes.
 *
 * Two rules keep it honest (D-028):
 *  - A handoff line is only produced when BOTH ends are known. A half-known
 *    move ("someone finished this") is dropped rather than half-invented.
 *  - Nothing is synthesised from a status alone. `ticket.closed` followed by
 *    someone else's `claim`/`comment` is a real relay; a ticket merely sitting
 *    in `in_review` is not, because nobody has picked it up yet.
 */
import type { TraceEvent } from '../board/drawer/types.js';

export interface Handoff {
  readonly seq: number;
  readonly at: string;
  readonly fromActor: string;
  readonly toActor: string;
  readonly ticketId: string | null;
  /** What moved — the phase name or the ticket. */
  readonly subject: string;
}

/** Pipeline stage events name the work that just completed. */
const STAGE_SUBJECT: Record<string, string> = {
  'pipeline.blueprint_ready': 'the blueprint',
  'pipeline.technical_slate_ready': 'the technical slate',
  'pipeline.ticket_drafts_ready': 'the ticket breakdown',
  'phase.advanced': 'the phase gate',
};

function actorTail(actorId: string): string {
  return actorId.slice(actorId.lastIndexOf(':') + 1);
}

/**
 * Handoffs in the order they happened. `events` must be one project's slice;
 * ordering is by `seq`, the log's own sequence, never by wall-clock.
 */
export function deriveHandoffs(events: readonly TraceEvent[]): Handoff[] {
  const bySeq = [...events].sort((a, b) => a.seq - b.seq);
  const out: Handoff[] = [];

  // maker -> reviewer: a close, then a DIFFERENT actor acting on the ticket.
  const closedBy = new Map<string, { actor: string; seq: number }>();
  for (const e of bySeq) {
    if (!e.ticket_id) continue;
    if (e.event_type === 'ticket.closed') {
      closedBy.set(e.ticket_id, { actor: actorTail(e.actor_id), seq: e.seq });
      continue;
    }
    const prior = closedBy.get(e.ticket_id);
    if (!prior) continue;
    const actor = actorTail(e.actor_id);
    if (actor === prior.actor) continue;
    if (e.event_type !== 'ticket.accepted' && e.event_type !== 'ticket.commented') {
      continue;
    }
    out.push({
      seq: e.seq,
      at: e.created_at,
      fromActor: prior.actor,
      toActor: actor,
      ticketId: e.ticket_id,
      subject: e.ticket_id,
    });
    closedBy.delete(e.ticket_id);
  }

  // pipeline stage -> whoever acted next: a phase finishing and work starting.
  let lastStage: { subject: string; actor: string; seq: number } | null = null;
  for (const e of bySeq) {
    const subject = STAGE_SUBJECT[e.event_type];
    if (subject) {
      lastStage = { subject, actor: actorTail(e.actor_id), seq: e.seq };
      continue;
    }
    if (!lastStage) continue;
    if (e.event_type !== 'ticket.claimed') continue;
    const actor = actorTail(e.actor_id);
    if (actor === lastStage.actor) continue;
    out.push({
      seq: e.seq,
      at: e.created_at,
      fromActor: lastStage.actor,
      toActor: actor,
      ticketId: e.ticket_id,
      subject: lastStage.subject,
    });
    lastStage = null;
  }

  return out.sort((a, b) => a.seq - b.seq);
}

/** One line naming both people. `nameOf` supplies the face, or the raw id. */
export function handoffLine(h: Handoff, nameOf: (actorId: string) => string): string {
  return `${nameOf(h.fromActor)} finished ${h.subject} — handing to ${nameOf(h.toActor)}`;
}
