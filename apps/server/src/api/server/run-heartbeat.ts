/**
 * server/run-heartbeat.ts — the `loop.heartbeat` producer (review R1).
 *
 * The web client has had a heartbeat consumer since W3-04 (card line, berths
 * strip, the drawer's "Live loop telemetry") and the server had no producer,
 * so during a run the board said nothing about what the agent was doing.
 *
 * WHAT IT READS: the run's own rows of the event log, read-only, since the
 * run began. Every field it publishes is something a ledgered event already
 * said — the claim, the berth admission, the worktree, a model turn opening
 * (`session.turn_started`, with its model), the model producing (with its tool
 * name), a rung climb, a receipt being minted. Nothing is guessed: a field no
 * event has stated yet is omitted, not filled in.
 *
 * WHAT IT IS NOT (Law 4, Law 7): telemetry. It never appends to the event log
 * and never changes a ticket's state; it publishes projection deltas on the
 * hub's `run:{runId}` subscription (API_DESIGN §3) and nothing else. A
 * dropped heartbeat costs a stale line on screen, never a wrong board.
 *
 * CADENCE: the log is polled every `pollMs` (1s). A ticket whose phase or step
 * changed is published on that tick; otherwise each active ticket is
 * re-published every `intervalMs` (5s) so a client can tell "quiet" from
 * "gone". When a ticket's work ends (closed, accepted, released, rejected,
 * parked by a conflict) one `loop.heartbeat_ended` goes out for it; `stop()`
 * publishes `loop.run_ended` and no heartbeat follows.
 */
import type { EventLog } from '@dokima/events';

export interface HeartbeatHub {
  publish(sub: string, type: string, data: unknown): unknown;
}

export type HeartbeatPhase =
  | 'claiming'
  | 'preparing'
  | 'working'
  | 'waiting_on_model'
  | 'retrying_provider'
  | 'escalating'
  | 'verifying'
  | 'reviewing'
  | 'paused';

/** The `data` of a `loop.heartbeat` envelope (API_DESIGN §3). */
export interface HeartbeatWire {
  readonly ticket: string;
  readonly run: string;
  readonly phase: HeartbeatPhase;
  readonly berth?: string;
  readonly step?: string;
  readonly model?: string;
  readonly rung?: string;
  /** Seconds since the last ledgered activity on this ticket. */
  readonly age_s: number;
  /** Seconds since this run first touched the ticket. */
  readonly elapsed_s: number;
  readonly started_at: string;
  readonly last_activity_at: string;
}

interface TicketActivity {
  phase: HeartbeatPhase;
  berth?: string;
  step?: string;
  model?: string;
  rung?: string;
  startedAt: string;
  lastActivityAt: string;
  /** phase+step as last published; a change publishes on the next tick. */
  lastSentKey?: string;
  lastSentAtMs?: number;
}

interface Row {
  seq: number;
  event_type: string;
  ticket_id: string | null;
  run_id: string | null;
  payload: string;
  created_at: string;
}

/** Events after which the agent is no longer working the ticket in this run. */
const ENDING = new Set([
  'ticket.closed',
  'ticket.accepted',
  'ticket.released',
  'ticket.rejected',
  'conflict.parked',
]);

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEFAULT_HEARTBEAT_POLL_MS = 1_000;

export interface RunHeartbeatOptions {
  readonly log: EventLog;
  readonly runId: string;
  readonly hub: HeartbeatHub;
  readonly intervalMs?: number;
  readonly pollMs?: number;
  readonly nowMs?: () => number;
}

export interface RunHeartbeat {
  /** One pass; exposed so tests drive it deterministically. */
  tick(): void;
  /** Ends the run's heartbeats: one `loop.run_ended`, then silence. Idempotent. */
  stop(): void;
}

function str(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function startRunHeartbeat(opts: RunHeartbeatOptions): RunHeartbeat {
  const { log, runId, hub } = opts;
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const topic = `run:${runId}`;
  const active = new Map<string, TicketActivity>();
  const select = log.db.prepare<[number], Row>(
    'SELECT seq, event_type, ticket_id, run_id, payload, created_at FROM events WHERE seq > ? ORDER BY seq ASC',
  );
  let lastSeq =
    log.db
      .prepare<[], { maxSeq: number }>(
        'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events',
      )
      .get()?.maxSeq ?? 0;
  let stopped = false;

  function fold(row: Row): void {
    const ticket = row.ticket_id;
    if (!ticket) return;
    // This run's rows, plus un-run-tagged rows about a ticket it is working
    // (`escalation.rung_advanced` carries no run id).
    if (row.run_id !== runId && !(row.run_id === null && active.has(ticket))) return;
    if (ENDING.has(row.event_type)) {
      if (active.delete(ticket)) {
        hub.publish(topic, 'loop.heartbeat_ended', {
          ticket,
          run: runId,
          reason: row.event_type,
        });
      }
      return;
    }
    const payload = parse(row.payload);
    const current: TicketActivity = active.get(ticket) ?? {
      phase: 'claiming',
      startedAt: row.created_at,
      lastActivityAt: row.created_at,
    };
    current.lastActivityAt = row.created_at;
    switch (row.event_type) {
      case 'ticket.claimed':
        current.phase = 'claiming';
        break;
      case 'berths.ticket_admitted':
        current.phase = 'claiming';
        current.berth = str(payload, 'berthId') ?? current.berth;
        break;
      case 'worktree.provisioned':
        current.phase = 'preparing';
        break;
      case 'ticket.started':
      case 'limit.resume':
        current.phase = 'working';
        current.step = undefined;
        break;
      case 'session.turn_started':
        current.phase = 'waiting_on_model';
        current.step = undefined;
        current.model = str(payload, 'model') ?? current.model;
        break;
      case 'session.producing':
        current.phase = 'working';
        current.model = str(payload, 'model') ?? current.model;
        current.step = str(payload, 'tool');
        break;
      case 'session.infra_retry':
        current.phase = 'retrying_provider';
        break;
      case 'escalation.rung_advanced':
        current.phase = 'escalating';
        current.rung = str(payload, 'toRung') ?? current.rung;
        current.step = undefined;
        break;
      case 'gate.receipt_minted':
        current.phase = 'verifying';
        current.step = undefined;
        break;
      case 'review.verdict':
        current.phase = 'reviewing';
        current.step = undefined;
        break;
      case 'limit.pause':
        current.phase = 'paused';
        current.step = undefined;
        break;
      default:
        // Any other row of this run about the ticket is still activity: it
        // moves `last_activity_at` without inventing a phase change.
        break;
    }
    active.set(ticket, current);
  }

  function wire(ticket: string, a: TicketActivity, now: number): HeartbeatWire {
    const secondsSince = (iso: string) =>
      Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
    return {
      ticket,
      run: runId,
      phase: a.phase,
      ...(a.berth ? { berth: a.berth } : {}),
      ...(a.step ? { step: a.step } : {}),
      ...(a.model ? { model: a.model } : {}),
      ...(a.rung ? { rung: a.rung } : {}),
      age_s: secondsSince(a.lastActivityAt),
      elapsed_s: secondsSince(a.startedAt),
      started_at: a.startedAt,
      last_activity_at: a.lastActivityAt,
    };
  }

  function tick(): void {
    if (stopped) return;
    for (const row of select.all(lastSeq)) {
      lastSeq = row.seq;
      fold(row);
    }
    const now = nowMs();
    for (const [ticket, a] of active) {
      const key = `${a.phase}|${a.step ?? ''}|${a.rung ?? ''}|${a.berth ?? ''}`;
      const due = a.lastSentAtMs === undefined || now - a.lastSentAtMs >= intervalMs;
      if (key === a.lastSentKey && !due) continue;
      a.lastSentKey = key;
      a.lastSentAtMs = now;
      hub.publish(topic, 'loop.heartbeat', wire(ticket, a, now));
    }
  }

  const timer = setInterval(() => {
    try {
      tick();
    } catch {
      // Telemetry never takes a run down: a failed read is a missed beat,
      // which the client already shows as stale.
    }
  }, opts.pollMs ?? DEFAULT_HEARTBEAT_POLL_MS);
  timer.unref?.();

  return {
    tick,
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      active.clear();
      hub.publish(topic, 'loop.run_ended', { run: runId });
    },
  };
}
