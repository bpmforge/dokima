/**
 * loop-land-preflight.ts — what happens to a claimed ticket BEFORE any model
 * call (W22-17 chapter split, under the 400-line CODE_BOOK_PROTOCOL cap).
 *
 * THIS IS ONE IDEA, not a line-count exercise. `loop-land-ticket.ts` already
 * named it three times in its own comments — W21-43's "before a single model
 * call", W21-21's provisioning, W21-52's "the third early-park path, now the
 * same shape as the other two" — while the code sat interleaved with ladder
 * setup. Three ways a ticket can be refused or prepared before a token is
 * spent read better beside each other than scattered through the engine.
 *
 * A SIBLING CHAPTER, not a directory. The protocol asks for an index plus
 * chapters, and this package already answers that its own way: loop-land-
 * session, -infra, -report, -board, -policy, -rungs are all chapters of one
 * engine with loop-land-ticket.ts as the index. A `loop-land-ticket/`
 * directory would instead force every importer to say `/index.js`, since Node
 * ESM does not resolve directories.
 *
 * A MOVE, NOT A REWRITE. Every line below came from loop-land-ticket.ts
 * unchanged, and the existing loop-land tests are the proof: this file is the
 * ladder's control flow, and a split that also improved behaviour would be
 * unreviewable against the tests that exist.
 */
import type { WorktreeHandle } from '@dokima/git';
import { commentTicket, releaseTicket, TicketError } from '@dokima/tickets';
import type { Ticket } from '@dokima/tickets';
import { unsatisfiableCriteria, unsatisfiableNotice } from './loop-land-satisfiable.js';
import { wrapHandoffForWorktree } from './loop-land-handoff-wrap.js';
import { provisionWorktree, provisionFailureReason } from './worktree-provision.js';
import { parkBeforeAttempting } from './loop-land-board.js';
import type { LandLoopOptions, LandLoopTicketOutcome } from './loop-land.js';

/**
 * W21-33: release, unless another run has since claimed the ticket.
 *
 * The park path is where the live defect fired: a run whose ladder was
 * exhausted released a ticket a NEWER run had claimed fourteen seconds
 * earlier, and the newer run's close receipt was orphaned. With the guard in
 * place that release now throws, and a throw here would be no better — it
 * would crash the park and lose the park evidence that took two attempts to
 * produce. The right behaviour for a run that no longer holds the ticket is to
 * leave it alone and say so, which is what this does.
 */
export function releaseUnlessTakenOver(options: LandLoopOptions, ticketId: string): void {
  try {
    releaseTicket(
      options.log,
      { ticketId, actorId: options.actorId },
      { runId: options.runId ?? null },
    );
  } catch (err) {
    if (!(err instanceof TicketError) || err.code !== 'STALE_RUN') throw err;
    commentTicket(
      options.log,
      {
        ticketId,
        actorId: options.actorId,
        body:
          `not released: another run has claimed this ticket since, so returning it ` +
          `to ready would take it away from the run currently working it (W21-33). ` +
          `${err.message}`,
      },
      { runId: options.runId ?? null },
    );
  }
}

/**
 * Either a park that happened before any attempt, or the options to run with.
 *
 * The options come BACK rather than being mutated in place because the
 * worktree wrap below rebuilds them, and a caller that ignored the returned
 * value would silently run the unwrapped handoff — the W21-12 shape, where a
 * step existed at one of three claim sites and a live run proved it never
 * executed.
 */
export type PreflightResult =
  | { readonly kind: 'parked'; readonly outcome: LandLoopTicketOutcome }
  | { readonly kind: 'ready'; readonly options: LandLoopOptions };

/**
 * Refuses or prepares a claimed ticket before the first model call.
 *
 * W21-21: provisioning lives in the shared engine, because there are THREE
 * claim sites — loop-claim's processTicket (which nothing calls), loop-land-
 * ticket's processTicket, and berths' injected runTicket — each with its own
 * resolveWorktree. W21-12 put it at one of them and a live run proved it never
 * executed. Everything that lands a ticket funnels through `landClaimedTicket`,
 * so calling this from there is the only place it cannot be bypassed.
 */
export async function preflightClaimedTicket(
  options: LandLoopOptions,
  ticket: Ticket,
  worktree: WorktreeHandle,
): Promise<PreflightResult> {
  // W21-43: before a single model call. An unsatisfiable ticket used to burn
  // its whole ladder — two sessions, every turn — to discover a mismatch
  // readable from the ticket record alone.
  const unsatisfiable = unsatisfiableCriteria(ticket.acceptance ?? [], ticket.writeScope);
  if (unsatisfiable.length > 0) {
    return {
      kind: 'parked',
      outcome: parkBeforeAttempting(
        options,
        ticket,
        unsatisfiableNotice(ticket.id, unsatisfiable),
        releaseUnlessTakenOver,
      ) as LandLoopTicketOutcome,
    };
  }
  const provision = await provisionWorktree({
    worktreePath: worktree.path,
    log: options.log,
    actorId: options.actorId,
    ticketId: ticket.id,
    // W21-32: the option existed and this call site never passed it.
    ...(options.runId ? { runId: options.runId } : {}),
  });
  const provisionFailure = provisionFailureReason(provision);
  if (provisionFailure) {
    // W21-52: the third early-park path, now the same shape as the other two.
    return {
      kind: 'parked',
      outcome: parkBeforeAttempting(
        options,
        ticket,
        provisionFailure,
        releaseUnlessTakenOver,
      ) as LandLoopTicketOutcome,
    };
  }

  /**
   * W21-22: the agent is told what is already true of the worktree it is
   * standing in. Wrapped locally rather than widening HandoffBuilder and every
   * caller — the same shape this engine already uses to wrap `spawn` for
   * redaction.
   */
  return {
    kind: 'ready',
    options: await wrapHandoffForWorktree(options, provision, worktree.path),
  };
}
