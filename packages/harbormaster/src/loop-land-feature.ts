/**
 * loop-land-feature.ts — per-feature landing (P6-05): the durable PARK ledger
 * and the feature-grouping policy, ported from the bootstrap conductor's
 * `scripts/conductor/feature-landing.mjs` into the product engine.
 *
 * Under `landing: 'per-feature'` a ticket that passes the close gate lands its
 * branch NOWHERE: the branch is kept, and the park is recorded as an
 * append-only event (`land.branch_parked`) beside the `ticket.closed` event
 * the close gate already minted. The ticket's STATUS stays `in_review` — the
 * honest resting state, because a human still accepts (maker != verifier,
 * C-4) — so a restart can never re-claim it (`isClaimable` takes only
 * `ready`) and never deletes the parked branch (`resolveWorktree` only runs
 * for claimable tickets). No direct DB write anywhere: the park is
 * `appendEvent`, the status is whatever the existing verbs already produced
 * (C-2/C-6).
 *
 * A feature whose members are ALL parked lands as ONE merge — see
 * `loop-land-feature-merge.ts` (the synthetic-branch engine) and
 * `loop-land-feature-run.ts` (the orchestration `runLandLoop` calls).
 * A feature with any open member — `blocked` deliberately included — WAITS:
 * half a feature on `main` is exactly the "kinda-working surprise" the
 * product loop exists to prevent (Challenger finding 5 in the bootstrap).
 */
import { appendEvent, listEvents, type EventLog } from '@dokima/events';
import type { Ticket } from '@dokima/tickets';

/** Per-project landing mode (Law L11 — an explicit choice, never a silent default). */
export type LandingMode = 'per-ticket' | 'per-feature';

/**
 * The board's feature map, recorded once per decompose. `tickets` uses the
 * board plane's snake-free member ids; the shape mirrors
 * `packages/pipeline/src/decompose/types.ts`'s `Feature` minimally — only
 * what grouping needs, so a richer record stays readable by this reader.
 */
export interface BoardFeature {
  readonly id: string;
  readonly title?: string;
  readonly tickets: readonly string[];
}

export const FEATURES_RECORDED_EVENT = 'board.features_recorded';
export const BRANCH_PARKED_EVENT = 'land.branch_parked';
export const FEATURE_LANDED_EVENT = 'feature.landed';

export interface RecordBoardFeaturesInput {
  readonly actorId: string;
  readonly features: readonly BoardFeature[];
  readonly runId?: string | null;
}

/**
 * Persist the board's features[] where the board rows themselves live — the
 * event log (C-6: append-only, hash-chained; a re-record supersedes, never
 * rewrites). `decompose()` already emits `plan.features`; the sweep in
 * `loop-land-feature-run.ts` records any caller-supplied map it was handed,
 * so the grouping survives a restart that passes none. (The decompose
 * board-lifecycle in apps/server is the natural second writer — outside
 * P6-05's write_scope, filed in the close report.)
 */
export function recordBoardFeatures(
  log: EventLog,
  input: RecordBoardFeaturesInput,
): void {
  appendEvent(log, {
    eventType: FEATURES_RECORDED_EVENT,
    actorId: input.actorId,
    runId: input.runId ?? null,
    payload: {
      features: input.features.map((feature) => ({
        id: feature.id,
        title: feature.title ?? null,
        tickets: [...feature.tickets],
      })),
    },
  });
}

interface FeaturesRecordedPayload {
  readonly features?: readonly {
    readonly id?: unknown;
    readonly title?: unknown;
    readonly tickets?: unknown;
  }[];
}

/** The board's current feature map: the LAST `board.features_recorded` event wins. */
export function readBoardFeatures(log: EventLog): readonly BoardFeature[] {
  const events = listEvents(log);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.eventType !== FEATURES_RECORDED_EVENT) continue;
    const payload = event.payload as FeaturesRecordedPayload | null;
    const rows = Array.isArray(payload?.features) ? payload.features : [];
    return rows
      .filter(
        (row) =>
          typeof row.id === 'string' &&
          Array.isArray(row.tickets) &&
          row.tickets.every((t: unknown) => typeof t === 'string'),
      )
      .map((row) => ({
        id: row.id as string,
        ...(typeof row.title === 'string' ? { title: row.title } : {}),
        tickets: row.tickets as string[],
      }));
  }
  return [];
}

/** One parked, close-gate-green branch: the tested head the drift check re-verifies at landing. */
export interface ParkedBranchRecord {
  readonly ticketId: string;
  readonly branch: string;
  readonly headSha: string;
}

export interface RecordParkedBranchInput extends ParkedBranchRecord {
  readonly actorId: string;
  readonly runId?: string | null;
}

/**
 * The park itself, durable: branch + tested head, appended beside the
 * `ticket.closed` event. Survives restart by construction — it IS the log.
 */
export function recordParkedBranch(log: EventLog, input: RecordParkedBranchInput): void {
  appendEvent(log, {
    eventType: BRANCH_PARKED_EVENT,
    actorId: input.actorId,
    ticketId: input.ticketId,
    runId: input.runId ?? null,
    payload: { branch: input.branch, head_sha: input.headSha },
  });
}

interface BranchParkedPayload {
  readonly branch?: unknown;
  readonly head_sha?: unknown;
}

interface FeatureLandedPayload {
  readonly tickets?: unknown;
}

/**
 * Live parks, replayed from the log in order: the latest park per ticket wins
 * (a rejected-and-re-closed ticket re-records), and a `feature.landed` event
 * RETIRES the parks it names — without that, every later run would try to
 * re-land a feature whose merge is already on the base branch.
 */
export function parkedBranches(log: EventLog): ReadonlyMap<string, ParkedBranchRecord> {
  const live = new Map<string, ParkedBranchRecord>();
  for (const event of listEvents(log)) {
    if (event.eventType === BRANCH_PARKED_EVENT && event.ticketId) {
      const payload = event.payload as BranchParkedPayload | null;
      if (typeof payload?.branch === 'string' && typeof payload?.head_sha === 'string') {
        live.set(event.ticketId, {
          ticketId: event.ticketId,
          branch: payload.branch,
          headSha: payload.head_sha,
        });
      }
    } else if (event.eventType === FEATURE_LANDED_EVENT) {
      const payload = event.payload as FeatureLandedPayload | null;
      const landed = Array.isArray(payload?.tickets) ? payload.tickets : [];
      for (const id of landed) {
        if (typeof id === 'string') live.delete(id);
      }
    }
  }
  return live;
}

/**
 * Which feature a ticket belongs to: the recorded features[] when one names
 * it, else the id-prefix cohort — the bootstrap's `featureOf` fallback
 * (`wave(id)` is `id.split('-')[0]`): W12 tickets are at least a cohort, if
 * not a feature.
 */
export function featureOf(ticketId: string, features: readonly BoardFeature[]): string {
  for (const feature of features) {
    if (feature.tickets.includes(ticketId)) return feature.id;
  }
  return `cohort:${ticketId.split('-')[0]}`;
}

export interface ReadyFeature {
  readonly featureId: string;
  readonly members: readonly ParkedBranchRecord[];
}

export interface WaitingFeature {
  readonly featureId: string;
  readonly parked: readonly string[];
  /** Members not yet parked and not closed — `blocked` deliberately included. */
  readonly open: readonly string[];
}

export interface FeatureReadiness {
  readonly ready: readonly ReadyFeature[];
  readonly waiting: readonly WaitingFeature[];
}

/**
 * `done`/`waived` are the only statuses that count as CLOSED without a park.
 * `blocked` must NOT: a feature landing without its blocked member's work is
 * exactly the half-feature this module forswears — it holds the whole
 * feature in WAITING until a person unblocks or re-scopes it (the bootstrap's
 * Challenger finding 5, mirrored).
 */
function isClosedWithoutPark(status: Ticket['status']): boolean {
  return status === 'done' || status === 'waived';
}

/**
 * Group live parks by feature and report which features are COMPLETE (every
 * member parked or closed) vs WAITING. Only complete features may land, and a
 * feature with zero parks is simply not in flight. Pure over its inputs — the
 * landing step (not this) re-checks branches against disk.
 */
export function featuresReadyToLand(input: {
  readonly tickets: readonly Ticket[];
  readonly parked: ReadonlyMap<string, ParkedBranchRecord>;
  readonly features: readonly BoardFeature[];
}): FeatureReadiness {
  const membership = new Map<string, { all: Ticket[]; parked: ParkedBranchRecord[] }>();
  for (const ticket of input.tickets) {
    const featureId = featureOf(ticket.id, input.features);
    let group = membership.get(featureId);
    if (!group) {
      group = { all: [], parked: [] };
      membership.set(featureId, group);
    }
    group.all.push(ticket);
    const park = input.parked.get(ticket.id);
    if (park) group.parked.push(park);
  }
  const ready: ReadyFeature[] = [];
  const waiting: WaitingFeature[] = [];
  for (const [featureId, group] of membership) {
    if (group.parked.length === 0) continue;
    const parkedIds = new Set(group.parked.map((p) => p.ticketId));
    const open = group.all
      .filter((t) => !parkedIds.has(t.id) && !isClosedWithoutPark(t.status))
      .map((t) => `${t.id} (${t.status})`);
    if (open.length === 0) {
      ready.push({ featureId, members: group.parked });
    } else {
      waiting.push({ featureId, parked: [...parkedIds], open });
    }
  }
  return { ready, waiting };
}
