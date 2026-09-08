/**
 * The post-close seam's composition (W23-12, AB-12).
 *
 * harbormaster owns WHEN this happens (the moment a ticket lands, inside the
 * one-ticket engine both the sequential and berth paths drive) and WHETHER an
 * acceptance is permitted (`decideMachineAccept`). This layer supplies the two
 * things only apps/server can: a reviewer model, and the repair loop that uses
 * it.
 *
 * IT IS BUILT ONLY FOR AN APPROVED RUN. `createPostCloseVerification` returns
 * `undefined` without a policy, and `landOptions.postClose` is then absent, so
 * a run nobody approved behaves exactly as it did — landing to `in_review` and
 * waiting for a person.
 */

import {
  currentSourceOf,
  verifyAndAcceptTicket,
  type LandLoopOptions,
  type VerifiedTicketOutcome,
} from '@dokima/harbormaster';
import type { EventLog } from '@dokima/events';
import type { ApprovedBuildPolicy } from '@dokima/harbormaster';
import { executeRepairRounds, type ExecuteRepairRoundsOptions } from './build-repair.js';
import type { ExecuteReviewPassOptions } from './review-pass.js';
import {
  approvedBuildDigest,
  DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS,
} from './approved-build.js';

export interface PostCloseVerificationOptions {
  readonly log: EventLog;
  readonly runId: string;
  /** Null on a run that is not an approved build — the seam is then not built at all. */
  readonly policy: ApprovedBuildPolicy | null;
  /** The digest of the build inputs as they stand right now, re-read per acceptance. */
  readonly currentInputDigest: () => string;
  readonly repair: Omit<ExecuteRepairRoundsOptions, 'ticketIds' | 'landOptions'>;
  /** Supplied late: the land options only exist once this seam is inside them. */
  readonly landOptions: () => LandLoopOptions;
  readonly stderr: (line: string) => void;
  readonly secretValues?: readonly string[];
  /** Every ticket this seam decided, in order — read back by the run for its final pass. */
  readonly decided: VerifiedTicketOutcome[];
}

export function createPostCloseVerification(
  options: PostCloseVerificationOptions,
): LandLoopOptions['postClose'] | undefined {
  if (!options.policy) return undefined;
  return async ({ ticketId, worktreePath }) => {
    try {
      const outcome = await verifyAndAcceptTicket({
        log: options.log,
        runId: options.runId,
        ticketId,
        policy: options.policy,
        // Consulted by the policy only when there is no valid approval, which
        // cannot happen here — the seam does not exist without one. The
        // conservative value, so a future path that loses the policy asks.
        mode: 'interactive',
        currentInputDigest: options.currentInputDigest(),
        repair: async (id) => {
          const [outcome] = await executeRepairRounds({
            ...options.repair,
            ticketIds: [id],
            landOptions: options.landOptions(),
          });
          return outcome ?? null;
        },
        currentSource: () =>
          currentSourceOf(ticketId, worktreePath, options.secretValues ?? []),
        ...(options.secretValues ? { secretValues: options.secretValues } : {}),
      });
      options.decided.push(outcome);
      options.stderr(
        outcome.accepted
          ? `[verify] ${ticketId}: accepted by the machine reviewer (${outcome.ruleId})`
          : `[verify] ${ticketId}: stays in review — ${outcome.reason} (${outcome.ruleId})`,
      );
    } catch (err) {
      /**
       * A reviewer that could not run must never undo a close. The work is
       * landed; the ticket stays `in_review` and a person reads it, which is
       * the behaviour of every run before this card.
       */
      options.stderr(
        `[verify] ${ticketId}: post-close verification failed, ticket stays in review ` +
          `(${err instanceof Error ? err.message.slice(0, 200) : String(err)})`,
      );
    }
  };
}

export interface RunReviewSeamsOptions {
  readonly log: EventLog;
  readonly runId: string;
  readonly command: {
    readonly actorId: string;
    readonly projectId: string;
    readonly budgetUsd?: number | null;
  };
  readonly repoRoot: string;
  /** Read late: the maker model is resolved after the runner is chosen. */
  readonly makerModel: () => string;
  /** Read late: which models a rung session actually ran, as the run goes. */
  readonly usedModels: () => readonly string[];
  readonly policy: ApprovedBuildPolicy | null;
  readonly secretValues: readonly string[];
  readonly stderr: (line: string) => void;
}

export interface RunReviewSeams {
  readonly reviewOptions: Omit<ExecuteReviewPassOptions, 'ticketIds'>;
  /** Every ticket the post-close seam decided — the run's final pass skips these. */
  readonly decided: VerifiedTicketOutcome[];
  readonly postClose: LandLoopOptions['postClose'] | undefined;
  /** The land options only exist once this seam is inside them; handed back here. */
  readonly useLandOptions: (options: LandLoopOptions) => void;
}

/**
 * The review options and the post-close seam, composed together because the
 * seam needs the review and the land options need the seam. `makerModel` and
 * `makerModels` are read through getters: the ladder records which models
 * actually ran as the run goes, and a snapshot taken here would make C-4's
 * refusal set wrong for any ticket that landed on a higher rung.
 */
export function createRunReviewSeams(options: RunReviewSeamsOptions): RunReviewSeams {
  const reviewOptions = {
    log: options.log,
    actorId: options.command.actorId,
    runId: options.runId,
    repoRoot: options.repoRoot,
    get makerModel() {
      return options.makerModel();
    },
    get makerModels() {
      return [options.makerModel(), ...options.usedModels()];
    },
    secretValues: options.secretValues,
    stderr: options.stderr,
    projectId: options.command.projectId, // W23-06: the pool's fair-scheduling key
  };
  const decided: VerifiedTicketOutcome[] = [];
  let landOptions: LandLoopOptions | null = null;
  const postClose = createPostCloseVerification({
    log: options.log,
    runId: options.runId,
    policy: options.policy,
    currentInputDigest: () =>
      approvedBuildDigest(options.log, {
        projectId: options.command.projectId,
        modelPolicy: null,
        budgetCents: Math.round((options.command.budgetUsd ?? 0) * 100),
        maxRepairRounds: DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS,
      }),
    repair: {
      log: options.log,
      runId: options.runId,
      review: reviewOptions,
      stderr: options.stderr,
      secretValues: options.secretValues,
    },
    landOptions: () => {
      if (!landOptions) {
        throw new Error(
          'post-close verification ran before the land options were handed back — ' +
            'a repair round has no engine to run the maker with',
        );
      }
      return landOptions;
    },
    stderr: options.stderr,
    secretValues: options.secretValues,
    decided,
  });
  return {
    reviewOptions,
    decided,
    postClose,
    useLandOptions: (value) => {
      landOptions = value;
    },
  };
}
