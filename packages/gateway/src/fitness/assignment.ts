/**
 * Guards a (model, role) assignment against its fitness card (FR-G6:
 * "Assigning an unfit pair warns with the card; proceeding requires
 * explicit ack event"). Structural mirror of
 * routing/maker-verifier.ts's guardMakerVerifierDistinct: a caller cannot
 * silently bypass the refusal, only pass an explicit ack and get an
 * event minted for it.
 *
 * A model with no card on file yet (never benched) is passed through
 * without warning — this guard only judges an *existing* verdict, it
 * does not itself mandate benching before first assignment. Wiring
 * "the matrix must call this on every assignment" belongs to whichever
 * future ticket owns packages/gateway/src/routing/** (out of this
 * ticket's write_scope) — same injection-point split W2-05's route()
 * and W2-07's BudgetPolicy leave for their consumers.
 *
 * 'marginal' is treated the same as 'unfit' here: neither is a clean
 * "fit", so both warn and require the same explicit ack.
 */

import type { FitnessAckEvent, FitnessEventSink } from './events.js';
import { noopFitnessEventSink } from './events.js';
import type { FitnessCardStore } from './store.js';
import type { AgentRole, FitnessCard } from './types.js';

export class UnfitAssignmentRefusedError extends Error {
  constructor(
    public readonly model: string,
    public readonly role: AgentRole,
    public readonly card: FitnessCard,
  ) {
    super(
      `refusing to assign model '${model}' to role '${role}' — fitness verdict '${card.verdict}' (harness ${card.harnessVersion}); set ack=true to proceed explicitly`,
    );
    this.name = 'UnfitAssignmentRefusedError';
  }
}

export interface GuardFitAssignmentInput {
  readonly model: string;
  readonly role: AgentRole;
  readonly store: FitnessCardStore;
  readonly harnessVersion: string;
  /** Explicit override to proceed past a non-'fit' verdict (FR-G6). */
  readonly ack?: boolean;
  readonly actorId: string;
  readonly sink?: FitnessEventSink;
  readonly now?: () => string;
}

export interface GuardFitAssignmentResult {
  /** The fitness card that was checked, if one exists (undefined = never benched — passed through silently). */
  readonly card?: FitnessCard;
  readonly ackEvent?: FitnessAckEvent;
}

export async function guardFitAssignment(
  input: GuardFitAssignmentInput,
): Promise<GuardFitAssignmentResult> {
  const card = input.store.get(input.model, input.role, input.harnessVersion);
  if (!card || card.verdict === 'fit') return { card };

  if (!input.ack) {
    throw new UnfitAssignmentRefusedError(input.model, input.role, card);
  }

  const now = input.now ?? (() => new Date().toISOString());
  const event: FitnessAckEvent = {
    type: 'fitness.unfit_ack',
    model: input.model,
    role: input.role,
    verdict: card.verdict,
    card,
    actorId: input.actorId,
    occurredAt: now(),
  };
  await (input.sink ?? noopFitnessEventSink).emit(event);
  return { card, ackEvent: event };
}
