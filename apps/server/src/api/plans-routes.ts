/**
 * Improvement Plans API (API_DESIGN §"rules & improvement plans", FR-PLAN2/4,
 * D-016). Nested under `/projects/{id}/...` rather than the API_DESIGN
 * catalog's bare `/plan-items/{id}/accept` — same documented deviation as
 * `rules-routes.ts` (plan_items, like rule_state, lives in the project's
 * own `state.db`, so every route needs the project id to resolve it).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PlanEvaluationSnapshot } from '@shipwright/pipeline';
import {
  badRequest,
  conflict,
  resolveProjectOrProblem,
} from './server/settings-route-helpers.js';
import {
  acceptPlanItem,
  dismissPlanItem,
  evaluatePlan,
  listPlanItems,
  verifyPlan,
} from './plans-store.js';
import { PlanStoreError, type PlanFunnel, type PlanItemRow } from './plans-types.js';
import {
  buildPlanEvaluationSnapshot,
  unresolvedSnapshotPaths,
} from '../scheduler/snapshot.js';

/** States `verifyPlan` (`plans-store.ts`) re-checks — mirrors `plans-store-rows.ts`'s `VERIFIABLE_STATES`. */
const VERIFIABLE_ITEM_STATES = new Set(['accepted', 'in_progress', 'done']);

export interface PlansRoutesOptions {
  home?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasNumberFields(value: unknown, fields: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return fields.every((f) => isFiniteNumber(record[f]));
}

/**
 * Structural check for a caller-supplied `PlanEvaluationSnapshot`
 * (`packages/pipeline/src/plans/types.ts`) — every leaf is a required
 * number, `phase` is the only nullable field. Lenient about extra keys,
 * strict about the ones a catalog `condition`/`verify` predicate can
 * actually dot-path into.
 */
function isPlanEvaluationSnapshot(value: unknown): value is PlanEvaluationSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.phase !== 'string' && s.phase !== null) return false;
  return (
    hasNumberFields(s.receipts, ['staleCount']) &&
    hasNumberFields(s.coverage, ['requiredSkipped']) &&
    hasNumberFields(s.findings, ['openCriticalUnwaived']) &&
    hasNumberFields(s.rules, ['fpHeavyCount']) &&
    hasNumberFields(s.tickets, ['oscillatingCount', 'blockedWithEvidenceMaxAgeDays']) &&
    hasNumberFields(s.spend, ['thresholdBreachRepeatCount']) &&
    hasNumberFields(s.gates, ['missingRedFixtureCount']) &&
    hasNumberFields(s.providers, ['unverifiedTosCount']) &&
    hasNumberFields(s.deliverables, ['orphanedCount']) &&
    hasNumberFields(s.planItems, ['regressedCount']) &&
    hasNumberFields(s.playbook, ['staleEntryCount'])
  );
}

function itemToWire(item: PlanItemRow) {
  return {
    id: item.id,
    catalog_id: item.catalogId,
    rank: item.rank,
    state: item.state,
    ticket_id: item.ticketId,
    verify_criterion: item.verifyCriterion,
    recommendation: item.recommendation,
    severity: item.severity,
    leverage: item.leverage,
    last_verified_at: item.lastVerifiedAt,
    evidence: item.evidence,
    created_at: item.createdAt,
    first_seen_at: item.firstSeenAt,
    attempt: item.attempt,
    dismissed_at: item.dismissedAt,
    dismissed_reason: item.dismissedReason,
  };
}

function funnelToWire(funnel: PlanFunnel) {
  return {
    raw_findings: funnel.rawFindings,
    plan_items: funnel.planItems,
    accepted: funnel.accepted,
    done: funnel.done,
    regressed: funnel.regressed,
  };
}

function statusForPlanStoreError(code: PlanStoreError['code']): number {
  return code === 'NOT_FOUND' ? 404 : 409;
}

function sendPlanStoreError(
  request: FastifyRequest,
  reply: FastifyReply,
  err: PlanStoreError,
): void {
  reply
    .code(statusForPlanStoreError(err.code))
    .type('application/problem+json')
    .send(conflict(request, err.message, err.code));
}

export function registerPlansRoutes(
  app: FastifyInstance,
  opts: PlansRoutesOptions = {},
): void {
  /** `GET /api/v1/projects/:id/plan` — ranked items + FR-RL4-style funnel (FR-PLAN4: zero LLM calls). */
  app.get(
    '/api/v1/projects/:id/plan',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const query = request.query as Record<string, unknown>;
      const includeDismissed = query.include_dismissed === 'true';
      const { items, funnel } = await listPlanItems(projectPath, { includeDismissed });
      return reply.send({ items: items.map(itemToWire), funnel: funnelToWire(funnel) });
    },
  );

  /** `POST /api/v1/projects/:id/plan/evaluate` body `{snapshot}` — matches the catalog, persists new `proposed` items. */
  app.post(
    '/api/v1/projects/:id/plan/evaluate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      if (!isPlanEvaluationSnapshot(body?.snapshot)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(request, 'body.snapshot must be a full PlanEvaluationSnapshot'),
          );
      }
      const { created } = await evaluatePlan(projectPath, body.snapshot);
      return reply.code(201).send({ created: created.map(itemToWire) });
    },
  );

  /**
   * `POST /api/v1/projects/:id/plan/verify` — re-checks accepted/in_progress/done
   * items (FR-PLAN3) against a snapshot the SERVER derives from real state
   * (`buildPlanEvaluationSnapshot`, `scheduler/snapshot.ts`). A caller-supplied
   * `body.snapshot` is never read: CLAUDE.md law 4 / SC-03 — an untrusted
   * bearer-token holder must not be able to self-attest verification and flip
   * `plan_items` to `done` with no receipt correlation (the CRITICAL
   * `docs/work/SECURITY_W5.md` wave-pass caught here).
   *
   * Mirrors `plan-scheduler.ts`'s `runNightlyVerify` skip-guard: if any
   * verifiable item's `verifyCriterion` references a snapshot path with no
   * live producer yet (`unresolvedSnapshotPaths`), the whole pass is skipped
   * rather than let a zero-filled field fabricate a `done`/`regressed`
   * verdict (C-1 local-first honesty) — same coarse, whole-project skip the
   * scheduler already uses, not a new primitive.
   */
  app.post(
    '/api/v1/projects/:id/plan/verify',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const { items } = await listPlanItems(projectPath);
      const skipped = items.some(
        (item) =>
          VERIFIABLE_ITEM_STATES.has(item.state) &&
          unresolvedSnapshotPaths(item.verifyCriterion).length > 0,
      );
      if (skipped) {
        return reply.send({ verified: [], regressed: [], skipped: true });
      }
      const snapshot = await buildPlanEvaluationSnapshot(projectPath);
      const { verified, regressed } = await verifyPlan(projectPath, snapshot);
      return reply.send({
        verified: verified.map(itemToWire),
        regressed: regressed.map(itemToWire),
        skipped: false,
      });
    },
  );

  /** `POST /api/v1/projects/:id/plan-items/:itemId/accept` body `{lane, write_scope?, depends_on?}` — may mint a board ticket. */
  app.post(
    '/api/v1/projects/:id/plan-items/:itemId/accept',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      if (typeof body?.lane !== 'string' || body.lane.trim().length === 0) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(badRequest(request, 'body.lane must be a non-empty string'));
      }
      const writeScope = Array.isArray(body.write_scope)
        ? body.write_scope.filter((s): s is string => typeof s === 'string')
        : undefined;
      const dependsOn = Array.isArray(body.depends_on)
        ? body.depends_on.filter((s): s is string => typeof s === 'string')
        : undefined;
      try {
        const { item, ticketCreated } = await acceptPlanItem(projectPath, itemId, {
          lane: body.lane,
          writeScope,
          dependsOn,
        });
        return reply.send({ item: itemToWire(item), ticket_created: ticketCreated });
      } catch (err) {
        if (err instanceof PlanStoreError) return sendPlanStoreError(request, reply, err);
        throw err;
      }
    },
  );

  /** `POST /api/v1/projects/:id/plan-items/:itemId/dismiss` body `{note}` — `proposed -> [*]`, requires a ledgered note. */
  app.post(
    '/api/v1/projects/:id/plan-items/:itemId/dismiss',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      if (typeof body?.note !== 'string' || body.note.trim().length === 0) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(badRequest(request, 'body.note must be a non-empty string'));
      }
      try {
        const item = await dismissPlanItem(projectPath, itemId, body.note);
        return reply.send({ item: itemToWire(item) });
      } catch (err) {
        if (err instanceof PlanStoreError) return sendPlanStoreError(request, reply, err);
        throw err;
      }
    },
  );
}
