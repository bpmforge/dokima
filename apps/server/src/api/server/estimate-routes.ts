/**
 * Dry-run cost estimate + escalation-ROI + weekly digest routes
 * (BLUEPRINT §12.2, FR-G7, US-307/309, GATE_ECONOMICS §3). Mirrors
 * `packages/gateway/src/estimate/**`'s algorithms rather than importing
 * them: `apps/server/package.json` (the dependency list) sits outside
 * this ticket's write_scope, and `@shipwright/gateway` isn't a declared
 * dependency of `apps/server` — the same constraint `server.ts`'s
 * `registerChatRoute` documents for cost provenance ("no cost tracking
 * reachable from apps/server"). The estimate math itself is small enough
 * to duplicate (same discipline as `apps/web/src/chat/fixtures.ts` hand-
 * mirroring `server.ts`'s chat fixture) — real board data drives it,
 * documented assumptions fill the gaps that have no producer yet.
 *
 * Two gaps, both honestly labeled rather than faked (C-1):
 *  - `@shipwright/tickets`' `Ticket` has no `points` field and
 *    `board-wire.ts`'s `wave` is always 0 (no producer, grep-verified) —
 *    every ticket estimates at 1 point in a single wave-0 bucket until a
 *    sizing/wave producer exists.
 *  - No persisted spend ledger (`budget_ledger`/`spend` tables have no
 *    migration — only `001_init.sql`/`002_receipts.sql` exist) and no
 *    persisted rule/suppression store (W4-06, blocked twice on exactly
 *    this migration) is reachable from `apps/server` — `/spend` and
 *    `/spend/digest` return honest-empty rollups (0 rows, not fabricated
 *    numbers), same precedent as `apps/server/src/api/projects.ts`'s
 *    `spend_today: 0`.
 */

import { openEventLogReader } from '@shipwright/events';
import { loadTickets } from '@shipwright/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';
import { problem } from '../problem.js';

export interface EstimateRoutesOptions {
  /** Fleet registry home dir override (defaults to computeShipwrightHome()) — tests only. */
  home?: string;
}

/** One role's blended $/point rate. Reproduces `packages/gateway/src/estimate/types.ts`'s `RoleRate` shape (see module header). */
interface RoleRate {
  readonly role: string;
  readonly usdPerPoint: number;
}

/**
 * Illustrative default rates for the BLUEPRINT §3.3 role set (matches
 * `packages/gateway/src/routing/presets.ts`'s `PRESET_ROLES` naming) — no
 * persisted model price table (`GET /models`) is reachable from
 * apps/server yet, so these stand in until one exists (documented, not
 * fabricated as "real" pricing).
 */
const DEFAULT_ROLE_MATRIX: readonly RoleRate[] = [
  { role: 'coding-agent', usdPerPoint: 0.08 },
  { role: 'code-reviewer', usdPerPoint: 0.15 },
  { role: 'challenger', usdPerPoint: 0.2 },
  { role: 'test-engineer', usdPerPoint: 0.05 },
  { role: 'pm-interviewer', usdPerPoint: 0.1 },
  { role: 'default', usdPerPoint: 0.05 },
];

const NO_SIZING_PRODUCER_NOTE =
  'ticket sizing defaults to 1 point/ticket in a single wave-0 bucket — no points/wave producer on the ticket model yet';
const NO_PRICE_TABLE_NOTE =
  'rates are illustrative defaults — no persisted model price table (GET /models) reachable from apps/server yet';
const NO_HISTORICAL_NOTE =
  'no historical actuals; estimate uses rate-table list-price only';
const NO_LEDGER_NOTE =
  'no persisted spend ledger reachable from apps/server yet (budget_ledger has no migration) — spend rollups are honest-empty';
const NO_SUPPRESSION_STORE_NOTE =
  'no persisted rule/suppression store reachable from apps/server yet (W4-06 blocked on this migration) — suppression volume is honest-empty';

interface WaveEstimateWire {
  wave: number;
  ticket_count: number;
  total_points: number;
  usd_per_point: number;
  estimated_usd: number;
}

function applyOverrides(
  matrix: readonly RoleRate[],
  overrides: Readonly<Record<string, number>>,
): RoleRate[] {
  return matrix.map((rate) =>
    rate.role in overrides
      ? { role: rate.role, usdPerPoint: overrides[rate.role] ?? rate.usdPerPoint }
      : rate,
  );
}

/** `points x sum(matrix rates)` over one wave-0 bucket of real tickets — mirrors `packages/gateway/src/estimate/estimate.ts`'s `computeWaveEstimate` for the single-wave case this route can honestly populate today. */
function estimateForTicketCount(
  ticketCount: number,
  matrix: readonly RoleRate[],
): { waves: WaveEstimateWire[]; totalUsd: number } {
  if (ticketCount === 0) return { waves: [], totalUsd: 0 };
  const usdPerPoint = matrix.reduce((sum, r) => sum + r.usdPerPoint, 0);
  const totalPoints = ticketCount; // 1 point/ticket (NO_SIZING_PRODUCER_NOTE)
  const estimatedUsd = totalPoints * usdPerPoint;
  return {
    waves: [
      {
        wave: 0,
        ticket_count: ticketCount,
        total_points: totalPoints,
        usd_per_point: usdPerPoint,
        estimated_usd: estimatedUsd,
      },
    ],
    totalUsd: estimatedUsd,
  };
}

function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

function notFound(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

async function ticketCountForProject(
  request: FastifyRequest,
  reply: FastifyReply,
  registryPath: string,
  projectId: string,
): Promise<number | undefined> {
  const record = await resolveProjectRecord(registryPath, projectId);
  if (!record) {
    await reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(notFound(request, `no project registered with id ${projectId}`));
    return undefined;
  }
  const db = openEventLogReader(stateDbPath(record.path));
  try {
    return loadTickets({ db, path: stateDbPath(record.path), close: () => db.close() })
      .size;
  } finally {
    db.close();
  }
}

function registerEstimateRoute(app: FastifyInstance, registryPath: string): void {
  app.get(
    '/api/v1/projects/:id/estimate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const ticketCount = await ticketCountForProject(
        request,
        reply,
        registryPath,
        projectId,
      );
      if (ticketCount === undefined) return reply;
      const { waves, totalUsd } = estimateForTicketCount(
        ticketCount,
        DEFAULT_ROLE_MATRIX,
      );
      return reply.send({
        waves,
        total_usd: totalUsd,
        assumptions: [NO_SIZING_PRODUCER_NOTE, NO_PRICE_TABLE_NOTE, NO_HISTORICAL_NOTE],
      });
    },
  );
}

interface WhatIfBody {
  overrides?: unknown;
}

function registerWhatIfRoute(app: FastifyInstance, registryPath: string): void {
  app.post(
    '/api/v1/projects/:id/estimate/what-if',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const ticketCount = await ticketCountForProject(
        request,
        reply,
        registryPath,
        projectId,
      );
      if (ticketCount === undefined) return reply;
      const body = (request.body ?? {}) as WhatIfBody;
      if (typeof body.overrides !== 'object' || body.overrides === null) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(request, 'body must be { overrides: { [role]: usdPerPoint } }'),
          );
      }
      const overrides = body.overrides as Record<string, unknown>;
      const numericOverrides: Record<string, number> = {};
      for (const [role, value] of Object.entries(overrides)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, `overrides.${role} must be a non-negative number`));
        }
        numericOverrides[role] = value;
      }
      const matrix = applyOverrides(DEFAULT_ROLE_MATRIX, numericOverrides);
      const { waves, totalUsd } = estimateForTicketCount(ticketCount, matrix);
      return reply.send({
        waves,
        total_usd: totalUsd,
        assumptions: [NO_SIZING_PRODUCER_NOTE, NO_PRICE_TABLE_NOTE, NO_HISTORICAL_NOTE],
      });
    },
  );
}

const SUPPORTED_GROUP_BY = new Set(['rung']);

/** `GET /projects/{id}/spend?group_by=rung` (API_DESIGN "budgets & spend"; US-309 AC-1/AC-2). Honest-empty until a spend ledger is reachable (module header). */
function registerSpendRoute(app: FastifyInstance, registryPath: string): void {
  app.get(
    '/api/v1/projects/:id/spend',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }
      const groupBy = (request.query as Record<string, unknown>).group_by;
      if (typeof groupBy !== 'string' || !SUPPORTED_GROUP_BY.has(groupBy)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'group_by must be "rung"'));
      }
      return reply.send({
        group_by: groupBy,
        items: [],
        assumptions: [NO_LEDGER_NOTE],
      });
    },
  );
}

/** Weekly Review-tier digest card (US-309 AC-1, GATE_ECONOMICS §3 suppression-volume input). Honest-empty until a spend ledger + rule/suppression store are reachable (module header). */
function registerDigestRoute(app: FastifyInstance, registryPath: string): void {
  app.get(
    '/api/v1/projects/:id/spend/digest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }
      const weekOf = new Date().toISOString().slice(0, 10);
      return reply.send({
        tier: 'review',
        week_of: weekOf,
        total_spend_usd: 0,
        by_rung: [],
        suppression_volume: [],
        assumptions: [NO_LEDGER_NOTE, NO_SUPPRESSION_STORE_NOTE],
      });
    },
  );
}

/** Dry-run estimate + escalation-ROI + weekly digest routes (module header). */
export function registerEstimateRoutes(
  app: FastifyInstance,
  opts: EstimateRoutesOptions,
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  registerEstimateRoute(app, registryPath);
  registerWhatIfRoute(app, registryPath);
  registerSpendRoute(app, registryPath);
  registerDigestRoute(app, registryPath);
}
