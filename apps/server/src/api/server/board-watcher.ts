/**
 * server/board-watcher.ts — the board is a projection of the EVENT LOG, not of
 * one HTTP handler (W10-75).
 *
 * `wsHub.publish` had exactly one call site in the whole server: inside
 * `POST /api/v1/tickets/:id/:verb`. So a board moved on screen only when the
 * founder's own browser moved it. Measured 2026-08-04 with a Canvas open: a
 * ticket closed from the CLI sat in "In Progress" indefinitely, and a reload
 * showed "In Review" with the receipt already minted — the write had landed;
 * only the notification was missing.
 *
 * That mattered little while the product had no agents. W10-77 landed the
 * loop, and now EVERY state change worth watching — claim, start, close, land,
 * auto-block — is made by something that is not the browser: the CLI, the
 * harbormaster loop, a berth, a second core. The Canvas was live for exactly
 * the changes the founder made themselves and silently stale for all the rest,
 * which is the opposite of the product's premise.
 *
 * WHY POLLING, and not an in-process hook: the writer is frequently a
 * DIFFERENT PROCESS (the CLI, a spawned session). No in-process event can
 * cross that boundary, and C-6's single-writer rule is per database, not per
 * machine. A read-only reader per tick is the same thing `computeProjectStats`
 * already does for every Fleet card.
 *
 * WHAT IT PUBLISHES: one `ticket.updated` per ticket whose wire row actually
 * CHANGED since the last tick. Republishing unchanged rows would inflate the
 * hub's per-subscription `seq` and push real deltas out of the 200-envelope
 * replay buffer that `ws-client.ts`'s `resume` depends on — a stale board
 * traded for a lossy one.
 */

import { openEventLogReader } from '@dokima/events';
import { loadTickets } from '@dokima/tickets';
import { loadRegistry } from '../projects/registry-store.js';
import { stateDbPath } from './board-project.js';
import { toWireBoardTicket } from './board-wire.js';
import type { WsHub } from '../ws-hub.js';

export const DEFAULT_BOARD_POLL_MS = 1_000;
const BOARD_TOPIC_PREFIX = 'board:';

export interface BoardWatcherOptions {
  readonly wsHub: WsHub;
  readonly registryPath: string;
  readonly pollIntervalMs?: number;
}

export interface BoardWatcher {
  /** One pass. Exposed so tests drive it deterministically instead of sleeping. */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

function projectIdFromTopic(topic: string): string | undefined {
  return topic.startsWith(BOARD_TOPIC_PREFIX)
    ? topic.slice(BOARD_TOPIC_PREFIX.length)
    : undefined;
}

export function createBoardWatcher(opts: BoardWatcherOptions): BoardWatcher {
  const { wsHub, registryPath } = opts;
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_BOARD_POLL_MS;
  /** projectId -> ticketId -> the exact JSON last broadcast for that ticket. */
  const lastSent = new Map<string, Map<string, string>>();
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;

  async function tick(): Promise<void> {
    // Never overlap: a slow tick must not stack up behind itself and open a
    // second reader on the same database.
    if (inFlight) return;
    inFlight = true;
    try {
      const topics = wsHub.activeSubscriptions();
      const projectIds = topics
        .map(projectIdFromTopic)
        .filter((id): id is string => id !== undefined);
      if (projectIds.length === 0) {
        lastSent.clear();
        return;
      }

      const records = await loadRegistry(registryPath);
      for (const projectId of projectIds) {
        const record = records.find((r) => r.id === projectId);
        if (!record) continue;
        publishChanges(projectId, record.path);
      }
    } finally {
      inFlight = false;
    }
  }

  function publishChanges(projectId: string, projectPath: string): void {
    let db;
    try {
      db = openEventLogReader(stateDbPath(projectPath));
    } catch {
      // A project whose database is missing, locked or on an older schema is
      // not worth crashing the watcher over — the same degrade
      // `computeProjectStats` makes for a Fleet card.
      return;
    }
    const log = { db, path: stateDbPath(projectPath), close: () => db.close() };
    try {
      const byId = loadTickets(log);
      const tickets = Array.from(byId.values());
      const seen = lastSent.get(projectId) ?? new Map<string, string>();
      const next = new Map<string, string>();
      for (const ticket of tickets) {
        const wire = toWireBoardTicket(ticket, byId);
        const encoded = JSON.stringify(wire);
        next.set(ticket.id, encoded);
        if (seen.get(ticket.id) === encoded) continue;
        // First tick for a project establishes the baseline without
        // broadcasting: a client that just subscribed already fetched the
        // board over REST, and replaying all of it would be noise.
        if (seen.size > 0) {
          wsHub.publish(`${BOARD_TOPIC_PREFIX}${projectId}`, 'ticket.updated', wire);
        }
      }
      lastSent.set(projectId, next);
    } finally {
      db.close();
    }
  }

  return {
    tick,
    start(): void {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
      lastSent.clear();
    },
  };
}
