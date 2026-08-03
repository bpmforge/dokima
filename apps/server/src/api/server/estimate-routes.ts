/**
 * Dry-run cost estimate + escalation-ROI + weekly digest routes
 * (BLUEPRINT §12.2, FR-G7, US-309, GATE_ECONOMICS §3).
 *
 * This route computes its own estimate rather than importing
 * `computeWaveEstimate` from `@dokima/gateway`: `@dokima/gateway`
 * is not a declared dependency of `apps/server`, and neither
 * `apps/server/package.json` nor `packages/gateway/package.json` (its
 * `exports` map) are in this ticket's `write_scope`, so the import is not
 * achievable without an out-of-scope edit (verified empirically — `import
 * '@dokima/gateway'` from `apps/server` throws `Cannot find package`).
 * A prior attempt at this ticket kept a duplicate, more general engine
 * under `packages/gateway/src/estimate/**` "for a future Harbormaster
 * consumer" and claimed `packages/loop` already depended on it; neither
 * was true (grep-verified: no package outside its own tests referenced
 * it), so it has been deleted rather than left as unreachable dead code.
 *
 * What is honestly delivered here, and why the rest isn't (C-1):
 *  - Per-wave breakdown: `@dokima/tickets`' `Ticket` has no `points`
 *    field and `board-wire.ts`'s `wave` is always 0 (no producer,
 *    grep-verified) — every ticket estimates at 1 point in a single
 *    wave-0 bucket until a sizing/wave producer exists on the ticket
 *    model. This is a real limit of the *data*, not something a smarter
 *    estimate function could work around: even the deleted gateway engine
 *    would collapse to the same single bucket fed today's inputs.
 *  - Historical per-ticket actuals: no persisted spend ledger
 *    (`budget_ledger`/`spend` tables have no migration — only
 *    `001_init.sql`/`002_receipts.sql` exist) is reachable from
 *    `apps/server`, and `Ticket`/`TicketManifest`/`TicketHistoryEntry`
 *    carry no cost data — so there is no historical-actuals source to
 *    override the rate table with. Estimates are rate-table list-price
 *    only.
 *  - Spend-by-rung / suppression volume: same missing ledger, plus no
 *    persisted rule/suppression store (W4-06, blocked twice on exactly
 *    this migration) — `/spend` and `/spend/digest` return honest-empty
 *    rollups (0 rows, not fabricated numbers), same precedent as
 *    `apps/server/src/api/projects.ts`'s `spend_today: 0`.
 */

import { openEventLogReader } from '@dokima/events';
import { loadTickets, type TicketStatus } from '@dokima/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectOrProblem, stateDbPath } from './board-project.js';
import { problem } from '../problem.js';

export interface EstimateRoutesOptions {
  /** Fleet registry home dir override (defaults to computeDokimaHome()) — tests only. */
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
  'every ticket is estimated as the same size right now, so this total cannot yet be broken down by wave or weighted for larger tickets';
const NO_PRICE_TABLE_NOTE =
  'rates shown are illustrative defaults, not your configured prices — once real model pricing is set up, the estimate will use those rates instead';
const NO_HISTORICAL_NOTE =
  'this estimate uses standard list-price rates only; there is no history of past spend yet to make it more accurate';
const NO_LEDGER_NOTE =
  'spend totals are blank because this project is not recording actual spend yet — once spend tracking is turned on, real dollar amounts will appear here instead of zero';
const NO_SUPPRESSION_STORE_NOTE =
  'suppression counts are blank because this project is not recording rule suppressions yet — once that tracking exists, counts per rule will appear here';
const DIGEST_DATE_NOTE =
  'the date above is when this digest was generated, in your local time — not the start or end of a calendar week, since there is no weekly spend history yet to bound it to a real week';

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

/** `points x sum(matrix rates)` over one wave-0 bucket of real tickets still pending autorun (module header: no wave/points producer on the ticket model yet, so every ticket is 1 point in a single bucket). */
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

/**
 * Local calendar date (`YYYY-MM-DD`) in the server's own timezone. Never
 * `Date#toISOString()`, which is always UTC and drifts the label a day
 * ahead once local wall-clock time has crossed into the next UTC day
 * (e.g. any evening in a timezone west of UTC) — Dokima runs local-first
 * (C-1), so the server's wall clock is the user's own.
 */
function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

/** Terminal statuses that are no longer pending autorun spend (BLUEPRINT §12.2 "money about to be spent", not money already spent). */
const CLOSED_STATUSES: ReadonlySet<TicketStatus> = new Set(['done', 'waived']);

async function ticketCountForProject(
  request: FastifyRequest,
  reply: FastifyReply,
  registryPath: string,
  projectId: string,
): Promise<number | undefined> {
  const record = await resolveProjectOrProblem(request, reply, registryPath, projectId);
  if (!record) return undefined;
  const db = openEventLogReader(stateDbPath(record.path));
  try {
    const tickets = loadTickets({
      db,
      path: stateDbPath(record.path),
      close: () => db.close(),
    });
    let pending = 0;
    for (const ticket of tickets.values()) {
      if (!CLOSED_STATUSES.has(ticket.status)) pending++;
    }
    return pending;
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
      const record = await resolveProjectOrProblem(
        request,
        reply,
        registryPath,
        projectId,
      );
      if (!record) return reply;
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
      const record = await resolveProjectOrProblem(
        request,
        reply,
        registryPath,
        projectId,
      );
      if (!record) return reply;
      const weekOf = localDateString(new Date());
      return reply.send({
        tier: 'review',
        week_of: weekOf,
        total_spend_usd: 0,
        by_rung: [],
        suppression_volume: [],
        assumptions: [NO_LEDGER_NOTE, NO_SUPPRESSION_STORE_NOTE, DIGEST_DATE_NOTE],
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
