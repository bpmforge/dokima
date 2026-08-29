/**
 * chat-projection.ts — the REAL chat stream (W13-63).
 *
 * `chat-fixture.ts` has served registered projects an EMPTY stream since it
 * was written, on the premise its own header states: "no chat or message
 * producer exists anywhere in this repo yet". That premise went stale weeks
 * ago — sessions append `ticket.commented`, `ticket.closed`,
 * `spend.recorded` and friends to every project's event log — and nobody
 * rewired the reader, so the Chat pane promised "messages, questions,
 * findings, and manifests appear here as agents work" and stayed silent
 * through a real agent session. Measured live on the novice rerun: a full
 * session ran, a ticket parked with evidence, and the pane said "No agent
 * activity yet."
 *
 * v1 projects SIGNAL, not the firehose: a park is a `card.finding` (the
 * evidence a person must read), a close is a `card.manifest` (the work that
 * landed). Turn-by-turn session chatter stays out — 24 producing events per
 * session is noise wearing a feed. Provenance is computed from the same
 * log: the latest model and summed spend for the ticket (FR-C2's "agent
 * name, model used, ticket ID, turn cost").
 *
 * Wire shapes mirror `chat-fixture.ts`'s items exactly — the web reducer
 * (`reduceChatEvents`) already speaks them, so the pane needs no change.
 */
import { existsSync } from 'node:fs';
import { listEvents, openEventLog, type EventLog } from '@dokima/events';

const PARK_MARKERS = ['Parked with evidence', 'auto-blocked with evidence'];

interface Envelope {
  sub: string;
  seq: number;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

function provenanceFor(
  events: readonly ReturnType<typeof listEvents>[number][],
  ticketId: string | null,
  actorId: string,
): Record<string, unknown> {
  let model = '—';
  let costUsd = 0;
  for (const event of events) {
    if (event.eventType !== 'spend.recorded') continue;
    if (ticketId !== null && event.ticketId !== ticketId) continue;
    const payload = event.payload as { model?: unknown; costUsd?: unknown };
    if (typeof payload.model === 'string') model = payload.model;
    if (typeof payload.costUsd === 'number') costUsd += payload.costUsd;
  }
  return {
    agent: actorId,
    model,
    ticket_id: ticketId ?? '—',
    cost_usd: Math.round(costUsd * 10000) / 10000,
    receipt_id: '',
  };
}

export function projectChatEnvelopes(log: EventLog, projectId: string): Envelope[] {
  const events = listEvents(log);
  const sub = `chat:${projectId}`;
  const out: Envelope[] = [];
  let openedThread = false;
  const openThread = (at: string, seq: number) => {
    if (openedThread) return;
    openedThread = true;
    out.push({
      sub,
      seq,
      type: 'thread.opened',
      at,
      data: { id: 'thread-program', kind: 'program', concern: null },
    });
  };

  for (const event of events) {
    const at = event.createdAt;
    if (event.eventType === 'ticket.commented') {
      const body = (event.payload as { body?: unknown }).body;
      if (typeof body !== 'string') continue;
      if (!PARK_MARKERS.some((marker) => body.startsWith(marker))) continue;
      openThread(at, event.seq);
      out.push({
        sub,
        seq: event.seq,
        type: 'card.finding',
        at,
        data: {
          id: `finding-${event.seq}`,
          thread_id: 'thread-program',
          provenance: provenanceFor(events, event.ticketId, event.actorId),
          severity: 'high',
          issue: body.length > 600 ? `${body.slice(0, 597)}…` : body,
          evidence_href: `?view=board`,
        },
      });
      continue;
    }
    if (event.eventType === 'ticket.closed') {
      const manifest = (event.payload as { manifest?: unknown }).manifest as
        | { files?: unknown; verify?: { exit?: unknown } }
        | undefined;
      const files = Array.isArray(manifest?.files)
        ? manifest.files.filter((f): f is string => typeof f === 'string')
        : [];
      openThread(at, event.seq);
      out.push({
        sub,
        seq: event.seq,
        type: 'card.manifest',
        at,
        data: {
          id: `manifest-${event.seq}`,
          thread_id: 'thread-program',
          provenance: provenanceFor(events, event.ticketId, event.actorId),
          files,
          verify_result: manifest?.verify?.exit === 0 ? 'pass' : 'fail',
          diff_stat: `${files.length} file(s)`,
        },
      });
    }
  }
  return out;
}

/**
 * Opens the project log read-only, projects, closes.
 *
 * ABSENT IS NOT BROKEN (W21-98). The header on this function was true and the
 * code did not implement it: it said "absent DB → empty stream (a project
 * that has never run has no chat — truthfully)" and then caught EVERYTHING
 * from `openEventLog`, so a corrupt database, a permissions error and a
 * schema mismatch each rendered as the same silent "no chat yet". A person
 * looking at an empty Chat pane could not tell which of those they had.
 *
 * The distinction is one this codebase already draws: `computeProjectStats`
 * re-checks the path and logs anything still there that still will not open
 * (W21-77), precisely because the vanished-project race is ordinary and the
 * unreadable-file case is not. Re-checked rather than string-matched for the
 * same reason it gives — better-sqlite3's wording is not a contract.
 *
 * It still degrades to empty either way. The Chat pane must not take the page
 * down, so this reports; it does not recover.
 */
export function chatEnvelopesForProject(dbPath: string, projectId: string): Envelope[] {
  let log: EventLog;
  try {
    log = openEventLog(dbPath);
  } catch (err) {
    if (existsSync(dbPath)) {
      console.error(`[chat] projection open failed for ${dbPath}:`, err);
    }
    return [];
  }
  try {
    return projectChatEnvelopes(log, projectId);
  } finally {
    log.close();
  }
}
