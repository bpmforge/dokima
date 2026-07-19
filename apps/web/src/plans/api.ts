/**
 * Improvement Plans REST client (API_DESIGN §"rules & improvement plans").
 * Same bearer-token-injected-by-the-SPA discipline as `notifications/api.ts`
 * (SC-08).
 */

import { readInjectedToken } from '../chat/api.js';
import type { PlanFunnel, PlanItem, PlanItemState } from './types.js';

interface PlanItemWire {
  id: string;
  catalog_id: string;
  rank: number;
  state: PlanItemState;
  ticket_id: string | null;
  verify_criterion: string;
  recommendation: string;
  severity: number;
  leverage: number;
  last_verified_at: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
  first_seen_at: string;
  attempt: number;
  dismissed_at: string | null;
  dismissed_reason: string | null;
}

interface PlanFunnelWire {
  raw_findings: number;
  plan_items: number;
  accepted: number;
  done: number;
  regressed: number;
}

function itemFromWire(wire: PlanItemWire): PlanItem {
  return {
    id: wire.id,
    catalogId: wire.catalog_id,
    rank: wire.rank,
    state: wire.state,
    ticketId: wire.ticket_id,
    verifyCriterion: wire.verify_criterion,
    recommendation: wire.recommendation,
    severity: wire.severity,
    leverage: wire.leverage,
    lastVerifiedAt: wire.last_verified_at,
    evidence: wire.evidence,
    createdAt: wire.created_at,
    firstSeenAt: wire.first_seen_at,
    attempt: wire.attempt,
    dismissedAt: wire.dismissed_at,
    dismissedReason: wire.dismissed_reason,
  };
}

function funnelFromWire(wire: PlanFunnelWire): PlanFunnel {
  return {
    rawFindings: wire.raw_findings,
    planItems: wire.plan_items,
    accepted: wire.accepted,
    done: wire.done,
    regressed: wire.regressed,
  };
}

export class PlansApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Plans API request failed with status ${status}`);
    this.name = 'PlansApiError';
  }
}

export interface PlansApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: PlansApiOptions,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readInjectedToken;
  const token = getToken();
  const res = await fetchImpl(`${opts.baseUrl ?? ''}${urlPath}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : undefined;
    throw new PlansApiError(res.status, detail);
  }
  return res.json();
}

/** `GET /api/v1/projects/:id/plan` — ranked items + FR-RL4-style funnel; zero LLM calls (FR-PLAN4). */
export async function fetchPlan(
  projectId: string,
  opts: PlansApiOptions = {},
): Promise<{ items: PlanItem[]; funnel: PlanFunnel }> {
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/plan`,
    { method: 'GET' },
    opts,
  )) as { items: PlanItemWire[]; funnel: PlanFunnelWire };
  return { items: body.items.map(itemFromWire), funnel: funnelFromWire(body.funnel) };
}

export interface AcceptPlanItemInput {
  lane: string;
  writeScope?: string[];
  dependsOn?: string[];
}

/** `POST /plan-items/:id/accept` — may mint a board ticket carrying the item's verify. */
export async function acceptPlanItem(
  projectId: string,
  itemId: string,
  input: AcceptPlanItemInput,
  opts: PlansApiOptions = {},
): Promise<PlanItem> {
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/plan-items/${encodeURIComponent(itemId)}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lane: input.lane,
        ...(input.writeScope ? { write_scope: input.writeScope } : {}),
        ...(input.dependsOn ? { depends_on: input.dependsOn } : {}),
      }),
    },
    opts,
  )) as { item: PlanItemWire };
  return itemFromWire(body.item);
}

/** `POST /plan-items/:id/dismiss` — `proposed -> [*]`, requires a ledgered note. */
export async function dismissPlanItem(
  projectId: string,
  itemId: string,
  note: string,
  opts: PlansApiOptions = {},
): Promise<PlanItem> {
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/plan-items/${encodeURIComponent(itemId)}/dismiss`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    },
    opts,
  )) as { item: PlanItemWire };
  return itemFromWire(body.item);
}
