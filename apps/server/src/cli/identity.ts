import { createIdentity, getIdentity, type EventLog } from '@dokima/events';

/**
 * v1 is single-operator (DECISIONS.md D-005) and this CLI is the only human
 * entry point into the event log — there is no separate `identity create`
 * step in this ticket's scope. A verb naming a fresh `--actor` provisions it
 * as `kind: 'human'` here rather than refusing with a raw FK-constraint
 * error from `events.actor_id`.
 */
export function ensureActorIdentity(
  log: EventLog,
  actorId: string,
  now?: () => string,
): void {
  if (getIdentity(log, actorId)) return;
  createIdentity(log, { id: actorId, name: actorId, kind: 'human' }, { now });
}
