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

/**
 * The machine identity every session lifecycle verb runs as (W21-70, C-4).
 *
 * `run start --actor founder` propagated that human into claim/start/close, so
 * a landed ticket was OWNED by whoever launched the run and `dokima accept
 * --actor founder` was refused SELF_ACCEPT (measured: PLAN-vault-002a, run 54,
 * seqs 4209/4210/4432). C-4 wants distinctness BY CONSTRUCTION; that made it
 * depend on the operator typing an `--actor` that was not their own id. It
 * stayed silent until a ticket actually landed, which is why fifteen runs that
 * only parked never surfaced it.
 *
 * Stable rather than per-run: the agent is one actor, and per-event provenance
 * is already carried by `runId` (W21-32). `kind: 'machine'` is what makes it
 * mechanical — mint.ts and waiver-policy.ts refuse a non-human signer, so this
 * identity cannot quietly acquire powers that belong to a person.
 */
export const SESSION_ACTOR_ID = 'dokima-agent';

export function ensureSessionActor(log: EventLog, now?: () => string): string {
  if (!getIdentity(log, SESSION_ACTOR_ID)) {
    createIdentity(
      log,
      { id: SESSION_ACTOR_ID, name: 'Dokima agent', kind: 'machine' },
      { now },
    );
  }
  return SESSION_ACTOR_ID;
}
