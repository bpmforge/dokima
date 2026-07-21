/**
 * Bridges onboard/health/security findings (`./onboard-executor.js`'s
 * `OnboardStepArtifact[]`) onto the board through the EXISTING Improvement
 * Plans lifecycle (`proposeFromMatches`/`acceptItem`) — mirrors
 * `board-lifecycle.ts`'s identical bridge for a decomposed pipeline plan
 * (ticket acceptance criterion #2), just with a specialist's reported
 * findings as the "matches" source instead of a decompose run.
 *
 * `catalogIdFor` is a stable content hash (stepId + role + normalized
 * title), NOT run-scoped — `proposeFromMatches`' own idempotency (skip any
 * catalogId already tracked) then means the SAME finding reported by a
 * later onboard run does not mint a second board ticket; only a genuinely
 * new finding does. This is the same "content fingerprint, not run id"
 * design `@shipwright/loop`'s `computeFindingFingerprint` uses for its own
 * finding ledger.
 *
 * AC3(a) (a finding cannot become a ticket without the receipts/verbs
 * path): `OnboardFinding` (`onboard-types.ts`) has no `state`/`ticketId`/
 * `signedBy` field, so there is no key on the untrusted, model-authored JSON
 * this module ever reads to decide lifecycle state — every item this module
 * creates starts `proposed` (`proposeFromMatches`'s own hardcoded initial
 * state) and only reaches `accepted` (and only then, a real board ticket)
 * through the real `acceptPlanItem` — the exact function
 * `POST /plan-items/:id/accept` calls, not a reimplementation.
 *
 * AC3(b) (a specialist cannot verify its own output, maker != verifier):
 * `acceptOnboardPlanItems` always signs the acceptance with
 * `OPERATOR_ACTOR_ID` (`acceptPlanItem`'s own hardcoded actor for
 * `createTicket`) — never an identity derived from the finding's own
 * `role`/`stepId`, and never anything read out of the specialist's JSON
 * response (there is no such field to read). The specialist's identity
 * (`specialist:<role>`, `onboard-executor.ts`) only ever signs the
 * step-complete AUDIT event for the step that PRODUCED the finding; it is
 * structurally never the identity that ACCEPTS it onto the board.
 */
import { createHash } from 'node:crypto';
import { appendEvent } from '@shipwright/events';
import { proposeFromMatches, type CatalogMatch } from '@shipwright/pipeline';
import { acceptPlanItem } from '../plans-store.js';
import type { PlanItemRow } from '../plans-types.js';
import {
  fromSqlRow,
  insertRow,
  SELECT_ALL,
  toRecord,
  toRow,
  withPlanWriter,
  type PlanItemSqlRow,
} from '../plans-store-rows.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../server/board-actor.js';
import type {
  OnboardFinding,
  OnboardFindingSeverity,
  OnboardStepArtifact,
} from './onboard-types.js';

const SEVERITY_RANK: Readonly<Record<OnboardFindingSeverity, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 4,
  CRITICAL: 5,
};

/** A specialist finding, still tagged with which step/role produced it —
 * needed for the catalogId hash and the security-vs-quality lane split,
 * never for lifecycle decisions (see module header AC3a). */
export interface OnboardFindingOrigin {
  readonly stepId: string;
  readonly role: string;
  readonly finding: OnboardFinding;
}

/** Flattens every step's artifact findings into origin-tagged records, in
 * step-id order (stable — `Object.keys` over a plain object populated in
 * insertion order by `onboard-executor.ts`). */
export function flattenOnboardFindings(
  stepArtifacts: Readonly<Record<string, OnboardStepArtifact>>,
): readonly OnboardFindingOrigin[] {
  const origins: OnboardFindingOrigin[] = [];
  for (const artifact of Object.values(stepArtifacts)) {
    for (const finding of artifact.findings) {
      origins.push({ stepId: artifact.stepId, role: artifact.role, finding });
    }
  }
  return origins;
}

/** Stable across runs (content hash, not run-scoped) — see module header. */
export function catalogIdFor(origin: OnboardFindingOrigin): string {
  const hash = createHash('sha256')
    .update(
      `${origin.stepId}\x00${origin.role}\x00${origin.finding.title.trim().toLowerCase()}`,
      'utf8',
    )
    .digest('hex')
    .slice(0, 16);
  return `onboard:${origin.stepId}:${hash}`;
}

/** `security-*`/`threat-model-refresh` step ids (the security-cluster
 * topology `run-onboard.ts` appends after `ONBOARD_STEPS`, W8-08) go to a
 * `security` board lane; every other onboard step to `quality` — derived
 * from the step id itself (data this ticket already has), not an imported
 * role-list constant (`modes/index.js`'s security-cluster role arrays are
 * out of this ticket's reach, same barrel wall `onboard-executor.ts`'s
 * header documents for the step topology). */
function laneForStepId(stepId: string): string {
  return stepId.startsWith('security-') || stepId === 'threat-model-refresh'
    ? 'security'
    : 'quality';
}

function toCatalogMatch(origin: OnboardFindingOrigin): CatalogMatch {
  return {
    catalogId: catalogIdFor(origin),
    recommendation: `[${origin.role}] ${origin.finding.title}: ${origin.finding.recommendation}`,
    verifyCriterion: origin.finding.verify,
    severity: SEVERITY_RANK[origin.finding.severity],
    leverage: 3,
  };
}

export interface OnboardFindingsPersistOptions {
  readonly runId: string;
  readonly now?: () => string;
}

/** Proposes one `plan_items` row per NEW finding (by content fingerprint —
 * `proposeFromMatches`' own idempotency skips any catalogId already
 * tracked). Single-writer discipline (DATABASE.md §1): opens its own writer
 * and closes it before returning, same as `board-lifecycle.ts`. */
export async function proposePlanItemsFromOnboardFindings(
  projectPath: string,
  origins: readonly OnboardFindingOrigin[],
  opts: OnboardFindingsPersistOptions,
): Promise<{ readonly created: readonly PlanItemRow[] }> {
  const now = opts.now ?? (() => new Date().toISOString());
  const matches = origins.map(toCatalogMatch);
  return withPlanWriter(projectPath, (log) => {
    ensureOperatorIdentity(log, now);
    const existingSqlRows = log.db.prepare(SELECT_ALL).all() as PlanItemSqlRow[];
    const existingRecords = existingSqlRows.map((r) => toRecord(fromSqlRow(r)));
    const created = proposeFromMatches(matches, existingRecords, { now });
    for (const record of created) insertRow(log.db, record);
    if (created.length > 0) {
      appendEvent(
        log,
        {
          eventType: 'onboard.plan_items_proposed',
          actorId: OPERATOR_ACTOR_ID,
          runId: opts.runId,
          payload: { createdIds: created.map((c) => c.id) },
        },
        { now },
      );
    }
    return { created: created.map(toRow) };
  });
}

export interface AcceptedOnboardFinding {
  readonly item: PlanItemRow;
  readonly ticketCreated: boolean;
}

/** Accepts every just-created item via the real `acceptPlanItem` — always
 * signed `OPERATOR_ACTOR_ID` (AC3b, module header). Runs sequentially (never
 * `Promise.all`): each call opens and closes its own single writer in turn. */
export async function acceptOnboardPlanItems(
  projectPath: string,
  created: readonly PlanItemRow[],
  origins: readonly OnboardFindingOrigin[],
  opts: { readonly now?: () => string } = {},
): Promise<readonly AcceptedOnboardFinding[]> {
  const byCatalogId = new Map(origins.map((o) => [catalogIdFor(o), o]));
  const results: AcceptedOnboardFinding[] = [];
  for (const created_ of created) {
    const origin = byCatalogId.get(created_.catalogId);
    if (!origin) {
      throw new Error(
        `no onboard finding found for catalogId "${created_.catalogId}" — proposePlanItemsFromOnboardFindings produced an item this run doesn't own`,
      );
    }
    const { item, ticketCreated } = await acceptPlanItem(
      projectPath,
      created_.id,
      { lane: laneForStepId(origin.stepId), writeScope: [], dependsOn: [] },
      opts,
    );
    results.push({ item, ticketCreated });
  }
  return results;
}

/** Convenience wrapper: propose then accept every onboard finding in one call. */
export async function persistOnboardFindings(
  projectPath: string,
  origins: readonly OnboardFindingOrigin[],
  opts: OnboardFindingsPersistOptions,
): Promise<readonly AcceptedOnboardFinding[]> {
  const { created } = await proposePlanItemsFromOnboardFindings(
    projectPath,
    origins,
    opts,
  );
  return acceptOnboardPlanItems(projectPath, created, origins, opts);
}
