/**
 * loop-land-feature-run.ts — how the land loop USES per-feature landing
 * (P6-05): the park step `runLandLoop` takes after a close-gate-green ticket,
 * and the idle-time sweep that lands every COMPLETE feature as one merge.
 *
 * Chapter of `loop-land.ts` under the 400-line CODE_BOOK_PROTOCOL cap. The
 * pure policy lives in `loop-land-feature.ts`, the git engine in
 * `loop-land-feature-merge.ts`; this file is only the composition — the same
 * relationship the bootstrap's `feature-landing-wiring.mjs` has to its
 * `feature-landing.mjs`.
 */
import { branchNameFor, git } from '@dokima/git';
import { commentTicket, listTickets, type Ticket } from '@dokima/tickets';
import { deriveVerifyCommand } from './verify-command.js';
import { reRunVerify } from './loop-gates-verify.js';
import { provisionWorktree, provisionFailureReason } from './worktree-provision.js';
import {
  featuresReadyToLand,
  parkedBranches,
  readBoardFeatures,
  recordBoardFeatures,
  recordParkedBranch,
  type BoardFeature,
} from './loop-land-feature.js';
import {
  landParkedFeature,
  type SyntheticBranchRecord,
  type SyntheticVerifyResult,
} from './loop-land-feature-merge.js';
import type { LandLoopOptions } from './loop-land.js';

/** One line per feature the idle sweep looked at: landed, refused, or waiting. */
export interface FeatureLandingReport {
  readonly featureId: string;
  readonly landed: boolean;
  readonly detail: string;
}

function normalized(features: readonly BoardFeature[]): string {
  return JSON.stringify(
    features.map((f) => ({ id: f.id, title: f.title ?? null, tickets: f.tickets })),
  );
}

/**
 * The feature map this sweep groups by — and its PERSISTENCE (acceptance 2):
 * a caller-supplied map is recorded onto the board's own event log the first
 * time it is seen (guarded by comparison, so a repeated sweep appends
 * nothing), which is what lets a restart that passes no `features` group
 * identically. With neither supplied nor recorded, `featureOf` falls back to
 * id-prefix cohorts.
 */
function resolveBoardFeatures(options: LandLoopOptions): readonly BoardFeature[] {
  const recorded = readBoardFeatures(options.log);
  if (!options.features) return recorded;
  if (normalized(recorded) !== normalized(options.features)) {
    recordBoardFeatures(options.log, {
      actorId: options.actorId,
      features: options.features,
      runId: options.runId ?? null,
    });
  }
  return options.features;
}

/**
 * The PARK: a ticket that just passed the close gate under
 * `landing: 'per-feature'` lands its branch nowhere — the branch is kept and
 * the tested head is recorded durably (append-only event beside the
 * `ticket.closed` the gate minted; C-2/C-6, no direct DB write). The ticket's
 * status is whatever `closeTicket` already produced (`in_review` — a human
 * still accepts), so a restart neither re-claims it nor deletes the branch.
 */
export async function parkLandedTicketBranch(
  options: LandLoopOptions,
  ticket: Ticket,
): Promise<void> {
  const branch = branchNameFor(ticket.id, ticket.title);
  const headSha = await git(options.repoRoot, ['rev-parse', '--verify', branch])
    .then((r) => r.stdout.trim())
    .catch(() => null);
  if (headSha === null) {
    // The close gate verified commits on this branch moments ago; its absence
    // is exceptional and must be a written trace, not a silent non-park.
    commentTicket(
      options.log,
      {
        ticketId: ticket.id,
        actorId: options.actorId,
        body: `per-feature landing could not park ${branch}: the branch does not resolve in ${options.repoRoot}; the feature this ticket belongs to will WAIT until a person restores or re-lands it`,
      },
      { runId: options.runId ?? null },
    );
    return;
  }
  recordParkedBranch(options.log, {
    actorId: options.actorId,
    ticketId: ticket.id,
    branch,
    headSha,
    runId: options.runId ?? null,
  });
}

/**
 * Tier-D verify for the synthetic head when the caller injects none: the
 * worktree is provisioned (the one deliberately-unsandboxed step, same as any
 * ticket worktree), then the verify command DERIVED FROM THE SYNTHETIC TREE
 * ITSELF runs under the SC-07 sandbox. Nothing derivable is a refusal, not a
 * pass — an unverified feature does not land (a check that cannot fail is
 * worse than no check).
 */
function defaultVerifySynthetic(
  options: LandLoopOptions,
  memberTicketId: string,
): (record: SyntheticBranchRecord) => Promise<SyntheticVerifyResult> {
  return async (record) => {
    const provision = await provisionWorktree({
      worktreePath: record.worktreePath,
      log: options.log,
      actorId: options.actorId,
      ticketId: memberTicketId,
      ...(options.runId ? { runId: options.runId } : {}),
    });
    const provisionFailure = provisionFailureReason(provision);
    if (provisionFailure) return { green: false, detail: provisionFailure };
    const command = await deriveVerifyCommand(record.worktreePath);
    if (!command) {
      return {
        green: false,
        detail:
          'no verify command derivable from the synthetic worktree — an unverified feature does not land',
      };
    }
    const result = await reRunVerify(
      record.worktreePath,
      command,
      options.verifyTimeoutMs ?? 10 * 60_000,
    );
    if (result.exitCode === 0) return { green: true, detail: command };
    return {
      green: false,
      detail: `${command} exited ${result.exitCode}: ${(result.stderr || result.stdout).slice(-400)}`,
    };
  };
}

/**
 * The idle-time sweep: group live parks by feature, WAIT on any feature with
 * an open member (`blocked` included — half a feature never lands), and land
 * each complete feature as ONE verified merge. Refusals (drift, advanced
 * base, code conflict, red verify) leave the base branch untouched and the
 * parked branches intact, and come back as readable report lines rather than
 * ledger-only traces.
 */
export async function landReadyFeatures(
  options: LandLoopOptions,
  baseRef: string,
): Promise<readonly FeatureLandingReport[]> {
  const parked = parkedBranches(options.log);
  if (parked.size === 0) return [];
  const features = resolveBoardFeatures(options);
  const { ready, waiting } = featuresReadyToLand({
    tickets: listTickets(options.log),
    parked,
    features,
  });
  const reports: FeatureLandingReport[] = [];
  for (const w of waiting) {
    reports.push({
      featureId: w.featureId,
      landed: false,
      detail: `waiting — ${w.parked.length} parked (${w.parked.join(', ')}), open: ${w.open.join(', ')}; a feature does not land in pieces`,
    });
  }
  for (const r of ready) {
    const outcome = await landParkedFeature(
      {
        log: options.log,
        actorId: options.actorId,
        runId: options.runId ?? null,
        repoRoot: options.repoRoot,
        baseRef,
        metadataPaths: options.featureMetadataPaths ?? [],
        verifySynthetic:
          options.verifyFeature ??
          defaultVerifySynthetic(options, r.members[0]!.ticketId),
      },
      r.featureId,
      r.members,
    );
    reports.push({
      featureId: outcome.featureId,
      landed: outcome.landed,
      detail: outcome.detail,
    });
  }
  return reports;
}
