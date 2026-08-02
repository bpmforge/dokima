/**
 * Roster REST client (API_DESIGN §"roster & feedback"). Same
 * bearer-token-injected-by-the-SPA discipline as `fleet/api.ts` — the
 * token comes from `window.__DOKIMA_TOKEN__`, never fetched over an
 * unauthenticated endpoint (SC-08).
 */

import { readInjectedToken } from '../chat/api.js';
import type {
  AgentHistory,
  RosterExpert,
  RosterHistoryEntry,
  RosterScope,
} from './types.js';

interface EffectiveModelWire {
  chain: string[];
  scope: RosterScope;
  used_default_role: boolean;
}

interface FitnessCardWire {
  model: string;
  verdict: 'fit' | 'unfit' | 'marginal';
  harness_version: string;
  run_at: string;
}

interface RosterExpertWire {
  id: string;
  display_name: string;
  cluster: string;
  mode: string;
  description: string;
  effective_model: EffectiveModelWire;
  fitness_cards: FitnessCardWire[];
  instruction_cost: number | null;
}

interface AgentHistoryEntryWire {
  seq: number;
  event_type: string;
  kind: RosterHistoryEntry['kind'];
  ticket_id: string | null;
  occurred_at: string;
}

interface AgentHistoryWire {
  agent_id: string;
  handoffs_run: number;
  outcomes: number;
  verdict_scores: number;
  spend: number;
  escalations: number;
  entries: AgentHistoryEntryWire[];
}

function expertFromWire(wire: RosterExpertWire): RosterExpert {
  return {
    id: wire.id,
    displayName: wire.display_name,
    cluster: wire.cluster,
    mode: wire.mode,
    description: wire.description,
    effectiveModel: {
      chain: wire.effective_model.chain,
      scope: wire.effective_model.scope,
      usedDefaultRole: wire.effective_model.used_default_role,
    },
    fitnessCards: wire.fitness_cards.map((card) => ({
      model: card.model,
      verdict: card.verdict,
      harnessVersion: card.harness_version,
      runAt: card.run_at,
    })),
    instructionCost: wire.instruction_cost,
  };
}

function historyFromWire(wire: AgentHistoryWire): AgentHistory {
  return {
    agentId: wire.agent_id,
    handoffsRun: wire.handoffs_run,
    outcomes: wire.outcomes,
    verdictScores: wire.verdict_scores,
    spend: wire.spend,
    escalations: wire.escalations,
    entries: wire.entries.map((entry) => ({
      seq: entry.seq,
      eventType: entry.event_type,
      kind: entry.kind,
      ticketId: entry.ticket_id,
      occurredAt: entry.occurred_at,
    })),
  };
}

export class RosterApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
    public readonly rule?: string,
  ) {
    super(detail ?? `Roster API request failed with status ${status}`);
    this.name = 'RosterApiError';
  }
}

export interface RosterApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(urlPath: string, opts: RosterApiOptions): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readInjectedToken;
  const token = getToken();
  const res = await fetchImpl(`${opts.baseUrl ?? ''}${urlPath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : undefined;
    const rule =
      typeof body === 'object' && body !== null && 'rule' in body
        ? String((body as { rule: unknown }).rule)
        : undefined;
    throw new RosterApiError(res.status, detail, rule);
  }
  return res.json();
}

export async function fetchRoster(
  filter: { projectId?: string } = {},
  opts: RosterApiOptions = {},
): Promise<RosterExpert[]> {
  const qs = filter.projectId ? `?project=${encodeURIComponent(filter.projectId)}` : '';
  const body = (await request(`/api/v1/roster${qs}`, opts)) as {
    experts: RosterExpertWire[];
  };
  return body.experts.map(expertFromWire);
}

export async function fetchAgentHistory(
  agentId: string,
  projectId: string,
  opts: RosterApiOptions = {},
): Promise<AgentHistory> {
  const wire = (await request(
    `/api/v1/roster/${encodeURIComponent(agentId)}/history?project=${encodeURIComponent(projectId)}`,
    opts,
  )) as AgentHistoryWire;
  return historyFromWire(wire);
}
