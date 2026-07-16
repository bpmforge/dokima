/**
 * Estimate/spend/digest REST client (`apps/server/src/api/server/
 * estimate-routes.ts`). Bearer token comes from
 * `window.__SHIPWRIGHT_TOKEN__`, same server-injected global
 * `apps/web/src/fleet/api.ts`/`apps/web/src/chat/api.ts` already read.
 */

import type {
  EscalationRoiRungGroup,
  EstimateResult,
  SpendByRungResult,
  SuppressionDigestRow,
  WaveEstimate,
  WeeklyDigest,
} from './types.js';

interface WaveEstimateWire {
  wave: number;
  ticket_count: number;
  total_points: number;
  usd_per_point: number;
  estimated_usd: number;
}

interface EstimateWire {
  waves: WaveEstimateWire[];
  total_usd: number;
  assumptions: string[];
}

interface EscalationRoiTicketRowWire {
  ticketId: string;
  spendUsd: number;
  outcome: string;
}

interface EscalationRoiRungGroupWire {
  rung: string;
  totalUsd: number;
  tickets: EscalationRoiTicketRowWire[];
}

interface SpendWire {
  group_by: string;
  items: EscalationRoiRungGroupWire[];
  assumptions: string[];
}

interface WeeklyDigestWire {
  tier: string;
  week_of: string;
  total_spend_usd: number;
  by_rung: EscalationRoiRungGroupWire[];
  suppression_volume: SuppressionDigestRow[];
  assumptions: string[];
}

function waveFromWire(wire: WaveEstimateWire): WaveEstimate {
  return {
    wave: wire.wave,
    ticketCount: wire.ticket_count,
    totalPoints: wire.total_points,
    usdPerPoint: wire.usd_per_point,
    estimatedUsd: wire.estimated_usd,
  };
}

function estimateFromWire(wire: EstimateWire): EstimateResult {
  return {
    waves: wire.waves.map(waveFromWire),
    totalUsd: wire.total_usd,
    assumptions: wire.assumptions,
  };
}

function rungGroupFromWire(wire: EscalationRoiRungGroupWire): EscalationRoiRungGroup {
  return {
    rung: wire.rung,
    totalUsd: wire.totalUsd,
    tickets: wire.tickets.map((t) => ({
      ticketId: t.ticketId,
      spendUsd: t.spendUsd,
      outcome: t.outcome,
    })),
  };
}

export class EstimateApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Estimate API request failed with status ${status}`);
    this.name = 'EstimateApiError';
  }
}

export function readInjectedToken(): string | undefined {
  return (globalThis as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__;
}

export interface EstimateApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: EstimateApiOptions,
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
    throw new EstimateApiError(res.status, detail);
  }
  return res.json();
}

export async function fetchEstimate(
  projectId: string,
  opts: EstimateApiOptions = {},
): Promise<EstimateResult> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/estimate`,
    { method: 'GET' },
    opts,
  )) as EstimateWire;
  return estimateFromWire(wire);
}

export async function postWhatIf(
  projectId: string,
  overrides: Readonly<Record<string, number>>,
  opts: EstimateApiOptions = {},
): Promise<EstimateResult> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/estimate/what-if`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overrides }),
    },
    opts,
  )) as EstimateWire;
  return estimateFromWire(wire);
}

export async function fetchSpendByRung(
  projectId: string,
  opts: EstimateApiOptions = {},
): Promise<SpendByRungResult> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/spend?group_by=rung`,
    { method: 'GET' },
    opts,
  )) as SpendWire;
  return {
    groupBy: wire.group_by,
    items: wire.items.map(rungGroupFromWire),
    assumptions: wire.assumptions,
  };
}

export async function fetchWeeklyDigest(
  projectId: string,
  opts: EstimateApiOptions = {},
): Promise<WeeklyDigest> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/spend/digest`,
    { method: 'GET' },
    opts,
  )) as WeeklyDigestWire;
  return {
    tier: wire.tier,
    weekOf: wire.week_of,
    totalSpendUsd: wire.total_spend_usd,
    byRung: wire.by_rung.map(rungGroupFromWire),
    suppressionVolume: wire.suppression_volume,
    assumptions: wire.assumptions,
  };
}
