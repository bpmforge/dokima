/**
 * cli/run-build-berths.ts — the concurrency dial, finally read (W16-02,
 * BLUEPRINT §3.6/§3.11, FR-H5, US-204).
 *
 * `--berths` was validated, stored on the run record, rendered by the web
 * ActiveBerthsStrip — and read by NOTHING: `executeBuildRun` always called
 * the sequential `runLandLoop` once. `runBerths` (the N-worker, lane-aware
 * engine, W3-04) had zero callers. This chapter is the composition: N > 1
 * drives `runBerths`, whose injected `runTicket` is `landClaimedTicket` —
 * the SAME one-ticket engine the sequential loop uses (loop-land-ticket.ts),
 * so the two paths cannot drift. Each berth carries its own machine
 * identity (FR-H5 — every verb it fires is attributed to that actor), and
 * every ticket admission passes through the `GlobalBerthGovernor`
 * (§3.11's fleet-wide fair scheduler; in a single-project CLI run it
 * bounds this project's own concurrency and its admissions are ledgered
 * so the pool's decisions are observable).
 *
 * Same-lane exclusivity (law 1) is `pickNextBerthTicket`'s invariant, not
 * re-derived here. C-6's single-writer holds because every berth shares
 * ONE process and ONE better-sqlite3 handle — writes are synchronous and
 * atomic; concurrency interleaves only at await points.
 *
 * A berth that THROWS halts every berth at its next boundary with the
 * error preserved (berths.ts's documented shared-abort) — an
 * evidence-preserving halt, deliberately not a silent continue: session
 * and provider failures are already absorbed INSIDE the engine
 * (runSessionAbsorbingProviderFailure), so an error escaping to the berth
 * layer is our own bug, and hiding it would be the silence this product
 * refuses.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import { GlobalBerthGovernor } from '@dokima/gateway';
import { resolveCurrentBranch } from '@dokima/git';
import {
  landClaimedTicket,
  landReadyFeatures,
  parkLandedTicketBranch,
  runBerths,
  type FeatureLandingReport,
  type LandLoopOptions,
  type LandLoopTicketOutcome,
} from '@dokima/harbormaster';

export interface BerthsRunSummary {
  readonly processed: readonly LandLoopTicketOutcome[];
  readonly stopReason: string;
  /** P6-11: per-feature mode — the idle-time feature sweep's reports. */
  readonly featureLandings?: readonly FeatureLandingReport[];
}

const STOP_PRIORITY = ['error', 'budget', 'stopped', 'breakpoint', 'idle'] as const;

export async function executeBerthsRun(opts: {
  readonly log: EventLog;
  readonly runId: string;
  readonly projectId: string;
  readonly berths: number;
  /** The fully composed sequential-loop options — actorId is REPLACED per berth (FR-H5). */
  readonly landOptions: LandLoopOptions;
  readonly stderr: (line: string) => void;
}): Promise<BerthsRunSummary> {
  const governor = new GlobalBerthGovernor();
  // LAZY, per W13-40's lesson in loop-land.ts: a run with nothing claimable
  // (or a cwd that is not even a repo yet) must not die resolving a branch
  // it will never use. Resolved once, at the first ticket that needs it.
  let baseRef: string | undefined;
  const resolveBaseRef = async (): Promise<string> =>
    (baseRef ??= await resolveCurrentBranch(opts.landOptions.repoRoot));
  const processed: LandLoopTicketOutcome[] = [];

  const result = await runBerths({
    log: opts.log,
    runId: opts.runId,
    projectId: opts.projectId,
    repoRoot: opts.landOptions.repoRoot,
    berths: opts.berths,
    ...(opts.landOptions.stopSwitch ? { stopSwitch: opts.landOptions.stopSwitch } : {}),
    ...(opts.landOptions.breakerLevel
      ? { breakerLevel: opts.landOptions.breakerLevel }
      : {}),
    ...(opts.landOptions.now ? { now: opts.landOptions.now } : {}),
    runTicket: async ({ ticket, worktree, berthId, actorId }) => {
      await governor.runBerth(opts.projectId, async () => {
        // Observable admission (§3.11): who got a slot, and how busy the
        // governor was when it decided.
        appendEvent(opts.log, {
          eventType: 'berths.ticket_admitted',
          actorId,
          ticketId: ticket.id,
          runId: opts.runId,
          payload: { berthId, governorActive: governor.activeCount },
        });
        const outcome = await landClaimedTicket(
          { ...opts.landOptions, actorId },
          ticket,
          worktree,
          await resolveBaseRef(),
        );
        // P6-11: the SAME park runLandLoop applies — a berth's landed ticket
        // parks its branch under per-feature landing; a park is not a landing.
        if (opts.landOptions.landing === 'per-feature' && outcome.landed) {
          await parkLandedTicketBranch({ ...opts.landOptions, actorId }, ticket);
          processed.push({ ...outcome, parkedForFeatureLanding: true });
        } else {
          processed.push(outcome);
        }
      });
    },
  });

  for (const berth of result.berths) {
    if (berth.stopReason === 'error') {
      opts.stderr(
        `${opts.runId}: ${berth.berthId} halted the run with an error — ` +
          `${berth.error instanceof Error ? berth.error.message : String(berth.error)}`,
      );
    }
  }
  const stopReason =
    STOP_PRIORITY.find((reason) =>
      result.berths.some((berth) => berth.stopReason === reason),
    ) ?? 'idle';
  // P6-11: the idle moment is when features land (the runLandLoop rule) —
  // a stopped/budget/error exit skips the sweep; parks are durable.
  if (opts.landOptions.landing === 'per-feature' && stopReason === 'idle') {
    return {
      processed,
      stopReason,
      featureLandings: await landReadyFeatures(opts.landOptions, await resolveBaseRef()),
    };
  }
  return { processed, stopReason };
}
