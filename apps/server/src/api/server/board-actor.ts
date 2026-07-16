import { createIdentity, getIdentity, type EventLog } from '@shipwright/events';

/**
 * API_DESIGN §1 "Actor attribution": mutations through this REST API carry
 * the operator's identity — berth and agent actions never come through here
 * (they act in-process via Harbormaster, or via the CLI with their own
 * `--actor`, `apps/server/src/cli/identity.ts`). One fixed id for v1
 * single-user mode (D-005): a ticket claimed/started/closed through the
 * board is owned by this id, distinct from any agent/CLI actor id — which
 * is exactly what makes D-020's `accept` authority split hold by
 * construction rather than by a synthetic reviewer.
 */
export const OPERATOR_ACTOR_ID = 'operator';

/** Mirrors the CLI's `ensureActorIdentity` (same FK-on-`events.actor_id` concern). */
export function ensureOperatorIdentity(log: EventLog, now?: () => string): void {
  if (getIdentity(log, OPERATOR_ACTOR_ID)) return;
  createIdentity(
    log,
    { id: OPERATOR_ACTOR_ID, name: 'Operator', kind: 'human' },
    { now },
  );
}
