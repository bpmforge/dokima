/**
 * The repair loop's production wiring (W23-11, AB-11).
 *
 * harbormaster owns the CYCLE and its bound; this layer owns the two things
 * only apps/server can do — resolve a reviewer model and run a maker session —
 * and hands them in as seams (the W13-23 boundary the review pass already
 * uses).
 *
 * IT RUNS ONLY ON AN APPROVED BUILD. Automatic reject-and-remake is the
 * behaviour a person said yes to once (W23-02's `approved-build-v1`); a run
 * nobody approved keeps the old shape exactly, which is an `in_review` ticket
 * and a verdict a human reads.
 *
 * WHAT THE REVIEW CAN ACTUALLY ATTRIBUTE, and no more. A verdict names its
 * blockers in sentences and its checks by id; it does not today name a file
 * and a line for each defect, so the structured `raw` list handed to
 * `consolidateFindings` is EMPTY on this path and the loop runs on blockers.
 * That is stated rather than faked: inventing a path so the batch looks
 * populated would put a fabricated location in front of a maker.
 */

import {
  processTicket,
  resolveTicketBase,
  runRepairRounds,
  type LandLoopOptions,
  type RepairTicketInputs,
  type RepairTicketOutcome,
} from '@dokima/harbormaster';
import { getTicket, listTickets } from '@dokima/tickets';
import { resolveCurrentBranch } from '@dokima/git';
import type { EventLog } from '@dokima/events';
import { executeReviewPass, type ExecuteReviewPassOptions } from './review-pass.js';

export interface ExecuteRepairRoundsOptions {
  readonly log: EventLog;
  readonly runId: string;
  readonly ticketIds: readonly string[];
  readonly landOptions: LandLoopOptions;
  readonly review: Omit<ExecuteReviewPassOptions, 'ticketIds'>;
  readonly stderr: (line: string) => void;
  readonly stopSwitch?: () => boolean | Promise<boolean>;
  readonly secretValues?: readonly string[];
}

/**
 * Reviews, repairs and re-reviews each ticket until it is confirmed or the
 * loop stops. Returns one outcome per ticket — including the ones it did not
 * touch, because "nothing happened to this ticket" is a report a person needs.
 */
export async function executeRepairRounds(
  options: ExecuteRepairRoundsOptions,
): Promise<readonly RepairTicketOutcome[]> {
  const inspect = async (ticketId: string): Promise<RepairTicketInputs> => {
    const ticket = getTicket(options.log, ticketId);
    const scopes = ticket
      ? [{ ticketId, writeScope: [...ticket.writeScope] }]
      : [{ ticketId, writeScope: [] }];
    // A ticket that is not in review has nothing for this loop to do — it
    // parked, or a person already accepted it.
    if (!ticket || ticket.status !== 'in_review') {
      return {
        eligible: true,
        blockers: [],
        infrastructure: [],
        sourceDigest: null,
        raw: [],
        scopes,
        verificationChecks: [],
      };
    }
    const { decisions } = await executeReviewPass({
      ...options.review,
      ticketIds: [ticketId],
    });
    const decision = decisions[0] ?? null;
    if (!decision) {
      /**
       * A skipped review is not a verdict. Without one there is no judgement
       * to repair against, and running the maker anyway would be the product
       * inventing work — so this parks with the reason a person can act on
       * (add a second model, or read the ticket yourself).
       */
      return {
        eligible: false,
        blockers: [],
        infrastructure: ['machine-review'],
        sourceDigest: null,
        raw: [],
        scopes,
        verificationChecks: [],
      };
    }
    return {
      eligible: decision.eligible,
      blockers: decision.ineligibleBecause,
      infrastructure: decision.checks
        .filter((c) => c.status === 'error' || c.status === 'unavailable')
        .map((c) => c.checkId),
      sourceDigest: decision.sourceDigest,
      raw: [],
      scopes,
      verificationChecks: [...decision.checks.map((c) => c.checkId), 'review'],
    };
  };

  const remake = async (ticketId: string): Promise<void> => {
    const ticket = getTicket(options.log, ticketId);
    if (!ticket) return;
    // W21-37, same as the land loop: a ticket forks from its accepted
    // dependencies' work, with the repo's own branch as the fallback.
    const base = await resolveTicketBase({
      repoRoot: options.landOptions.repoRoot,
      ticket,
      tickets: listTickets(options.log),
      fallbackRef:
        options.landOptions.baseRef ??
        (await resolveCurrentBranch(options.landOptions.repoRoot)),
    });
    if (!base.ok) {
      options.stderr(`[repair] ${ticketId}: no usable base — ${base.reason}`);
      return;
    }
    // The SAME engine the berth layer runs, so a repair attempt is a normal
    // attempt in every respect: ladder, close gate, park, push.
    await processTicket(options.landOptions, ticket, base.ref);
  };

  const outcomes = await runRepairRounds({
    log: options.log,
    runId: options.runId,
    ticketIds: options.ticketIds,
    inspect,
    remake,
    ...(options.stopSwitch ? { stopped: options.stopSwitch } : {}),
    ...(options.secretValues ? { secretValues: options.secretValues } : {}),
  });

  for (const outcome of outcomes) {
    if (outcome.stop === 'confirmed' && outcome.rounds === 0) continue;
    options.stderr(
      `[repair] ${outcome.ticketId}: ${outcome.stop} after ${outcome.rounds} round(s) — ${outcome.reason}`,
    );
  }
  return outcomes;
}
