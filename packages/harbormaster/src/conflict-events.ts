/**
 * Event minting for the conflict policy (ARCHITECTURE.md §3 event-type
 * list, FR-T6): `human.file_edited` fires for every edit the watcher
 * observes on the human's checkout — actorId is the human identity itself,
 * which is the attribution (FR-L4: "human edits are attributed events,
 * credited in coverage" — feeding an actual `CoverageTracker.complete()`
 * call is the composing caller's job in `packages/loop`, out of this
 * write_scope, same "drop-in unit a future ticket composes in" posture as
 * `limit-pause.ts`). `conflict.detected` fires additionally for edits that
 * collide with an active lease. `conflict.rebased` is the re-ground signal
 * a clean rebase mints; `conflict.parked` pairs with the evidence
 * `commentTicket` + `releaseTicket` a material conflict performs
 * (`conflict-rebase.ts`) — the same "auto-blocked with evidence" shape
 * `watchdog.ts`/`loop-land.ts` already use.
 */

import {
  appendEvent,
  listEvents,
  type EventLog,
  type EventRecord,
} from '@dokima/events';
import type { ConflictDetection } from './conflict-types.js';

export interface MintConflictEventOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
}

export interface HumanFileEditedPayload {
  readonly path: string;
}

/** Every human edit the watcher observes, in or out of a lease (UC-04 A2: outside a lease it's still an ordinary event). */
export function mintHumanFileEdited(
  log: EventLog,
  humanActorId: string,
  ticketId: string | null,
  edit: { readonly path: string },
  opts: MintConflictEventOptions = {},
): EventRecord {
  const payload: HumanFileEditedPayload = { path: edit.path };
  return appendEvent(
    log,
    { eventType: 'human.file_edited', actorId: humanActorId, ticketId, payload },
    opts,
  );
}

export interface ConflictDetectedPayload {
  readonly path: string;
  readonly ownerId: string;
  readonly matchedGlob: string;
}

/** BLUEPRINT §7.3 step 2: a human edit inside an actively-leased write-scope. */
export function mintConflictDetected(
  log: EventLog,
  actorId: string,
  detection: ConflictDetection,
  opts: MintConflictEventOptions = {},
): EventRecord {
  const payload: ConflictDetectedPayload = {
    path: detection.path,
    ownerId: detection.ownerId,
    matchedGlob: detection.matchedGlob,
  };
  return appendEvent(
    log,
    { eventType: 'conflict.detected', actorId, ticketId: detection.ticketId, payload },
    opts,
  );
}

export interface ConflictRebasedPayload {
  readonly baseRef: string;
  readonly ontoSha: string;
}

/** A clean rebase onto the human's change — the re-ground signal (BLUEPRINT §7.3 step 3: "the micro-loop re-grounds"). */
export function mintConflictRebased(
  log: EventLog,
  actorId: string,
  ticketId: string,
  payload: ConflictRebasedPayload,
  opts: MintConflictEventOptions = {},
): EventRecord {
  return appendEvent(
    log,
    { eventType: 'conflict.rebased', actorId, ticketId, payload },
    opts,
  );
}

export interface ConflictParkedPayload {
  readonly conflictedPaths: readonly string[];
}

/** A material rebase conflict — paired with the park comment + release in `conflict-rebase.ts`. */
export function mintConflictParked(
  log: EventLog,
  actorId: string,
  ticketId: string,
  payload: ConflictParkedPayload,
  opts: MintConflictEventOptions = {},
): EventRecord {
  return appendEvent(
    log,
    { eventType: 'conflict.parked', actorId, ticketId, payload },
    opts,
  );
}

/**
 * Checkpoint predicate (BLUEPRINT §7.3: "the affected loop checkpoints at
 * its next pass boundary"): true from the moment a `conflict.detected`
 * event lands for `ticketId` until a `conflict.rebased`/`conflict.parked`
 * event resolves it — durable and rebuildable from the log (CLAUDE.md law
 * 7), the same "no separate stored flag, recompute from the log" discipline
 * `@dokima/tickets`' `reflow.ts` uses for `blocked`. A caller wiring a
 * running micro-loop to this (out of this ticket's write_scope,
 * `packages/loop`) checks it between passes exactly the way
 * `loop-killswitch.ts`'s `StopSwitch` is checked between tickets.
 */
export function hasPendingConflict(log: EventLog, ticketId: string): boolean {
  const relevant = listEvents(log).filter(
    (event) =>
      event.ticketId === ticketId &&
      (event.eventType === 'conflict.detected' ||
        event.eventType === 'conflict.rebased' ||
        event.eventType === 'conflict.parked'),
  );
  const last = relevant[relevant.length - 1];
  return last?.eventType === 'conflict.detected';
}
