/**
 * Per-berth machine identity (DATABASE.md §2 `identities`, D-010): "one
 * machine identity per berth as berths are created" — `events.actor_id`
 * is FK-enforced (loop-claim.ts's own module doc), so every event a berth
 * causes needs a real `identities` row to point at before any ticket verb
 * can run under that berth's actorId.
 *
 * Identity ids are derived deterministically from `(runId, berthIndex)`
 * rather than generated, so re-resolving the same run's berths (a resumed
 * run, a retried `runBerths` call) reuses the same rows instead of
 * minting duplicates that would fork a berth's event history across two
 * identities.
 */

import {
  createIdentity,
  getIdentity,
  type EventLog,
  type IdentityRecord,
} from '@dokima/events';

/** Deterministic identity id for berth `berthIndex` (1-based) of `runId`. */
export function berthIdentityId(runId: string, berthIndex: number): string {
  return `berth-${runId}-${berthIndex}`;
}

export interface EnsureBerthIdentitiesOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  readonly now?: () => string;
  /** Defaults to `'Berth'` — identity name becomes `'<prefix> <index> (<runId>)'`. */
  readonly namePrefix?: string;
}

/**
 * Ensures `count` machine identities exist for `runId`'s berths, minting
 * whichever don't already have a row and returning all `count` in berth
 * order (index 1..count). Idempotent: an identity already present (from a
 * prior call for the same run) is reused verbatim, never re-created or
 * mutated.
 */
export function ensureBerthIdentities(
  log: EventLog,
  runId: string,
  count: number,
  opts: EnsureBerthIdentitiesOptions = {},
): IdentityRecord[] {
  const namePrefix = opts.namePrefix ?? 'Berth';
  const identities: IdentityRecord[] = [];
  for (let index = 1; index <= count; index += 1) {
    const id = berthIdentityId(runId, index);
    const existing = getIdentity(log, id);
    identities.push(
      existing ??
        createIdentity(
          log,
          {
            id,
            name: `${namePrefix} ${index} (${runId})`,
            kind: 'machine',
            role: 'berth',
          },
          { now: opts.now },
        ),
    );
  }
  return identities;
}
