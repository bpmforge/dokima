/**
 * Settings REST client, part 2 (API_DESIGN §116-137, D-014, D-019, R-M1):
 * rule lifecycle, suppression review, Copilot consent, guide loader. Split
 * from api.ts to stay under the 400-line cap; same client shape.
 */

import { jsonInit, request, type SettingsApiOptions } from './api-client.js';
import type {
  CopilotConsent,
  GuideTopic,
  RuleState,
  Suppression,
  SuppressionJustification,
} from './types.js';

// --- rule lifecycle + suppressions -----------------------------------------

interface RuleStateWire {
  rule_id: string;
  state: RuleState['state'];
  fp_window_findings: number;
  fp_window_fps: number;
  fp_rate: number;
  promoted_at: string | null;
  demotion_flagged: boolean;
  updated_at: string;
}

function ruleFromWire(wire: RuleStateWire): RuleState {
  return {
    ruleId: wire.rule_id,
    state: wire.state,
    fpWindowFindings: wire.fp_window_findings,
    fpWindowFps: wire.fp_window_fps,
    fpRate: wire.fp_rate,
    promotedAt: wire.promoted_at,
    demotionFlagged: wire.demotion_flagged,
    updatedAt: wire.updated_at,
  };
}

export async function fetchRules(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<RuleState[]> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rules`,
    jsonInit('GET'),
    opts,
  )) as { rules: RuleStateWire[] };
  return wire.rules.map(ruleFromWire);
}

export async function registerRule(
  projectId: string,
  ruleId: string,
  opts: SettingsApiOptions = {},
): Promise<void> {
  await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(ruleId)}/register`,
    jsonInit('POST'),
    opts,
  );
}

export async function promoteRule(
  projectId: string,
  ruleId: string,
  opts: SettingsApiOptions = {},
): Promise<RuleState> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(ruleId)}/promote`,
    jsonInit('POST'),
    opts,
  )) as Omit<
    RuleStateWire,
    | 'fp_window_findings'
    | 'fp_window_fps'
    | 'promoted_at'
    | 'demotion_flagged'
    | 'updated_at'
  > &
    Partial<RuleStateWire>;
  return {
    ruleId: wire.rule_id,
    state: wire.state,
    fpWindowFindings: wire.fp_window_findings ?? 0,
    fpWindowFps: wire.fp_window_fps ?? 0,
    fpRate: wire.fp_rate ?? 0,
    promotedAt: wire.promoted_at ?? null,
    demotionFlagged: wire.demotion_flagged ?? false,
    updatedAt: wire.updated_at ?? '',
  };
}

export async function demoteRule(
  projectId: string,
  ruleId: string,
  opts: SettingsApiOptions = {},
): Promise<void> {
  await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(ruleId)}/demote`,
    jsonInit('POST'),
    opts,
  );
}

interface SuppressionWire {
  id: number;
  fingerprint: string;
  rule_id: string | null;
  justification: SuppressionJustification;
  signed_by: string;
  context_key: string;
  status: 'active' | 'reopened';
  created_at: string;
  reopened_at: string | null;
}

function suppressionFromWire(wire: SuppressionWire): Suppression {
  return {
    id: wire.id,
    fingerprint: wire.fingerprint,
    ruleId: wire.rule_id,
    justification: wire.justification,
    signedBy: wire.signed_by,
    contextKey: wire.context_key,
    status: wire.status,
    createdAt: wire.created_at,
    reopenedAt: wire.reopened_at,
  };
}

export async function fetchSuppressions(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<Suppression[]> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/suppressions`,
    jsonInit('GET'),
    opts,
  )) as { suppressions: SuppressionWire[] };
  return wire.suppressions.map(suppressionFromWire);
}

export async function createSuppression(
  projectId: string,
  fingerprint: string,
  input: {
    justification: SuppressionJustification;
    signature: string;
    contextKey?: string;
    ruleId?: string;
  },
  opts: SettingsApiOptions = {},
): Promise<Suppression> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(fingerprint)}/suppress`,
    jsonInit('POST', {
      justification: input.justification,
      signature: input.signature,
      ...(input.contextKey !== undefined ? { context_key: input.contextKey } : {}),
      ...(input.ruleId !== undefined ? { rule_id: input.ruleId } : {}),
    }),
    opts,
  )) as SuppressionWire;
  return suppressionFromWire(wire);
}

// --- Copilot consent (D-019) ------------------------------------------------

export async function fetchCopilotConsent(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<CopilotConsent> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/copilot-consent`,
    jsonInit('GET'),
    opts,
  )) as CopilotConsent;
}

export async function enableCopilotConsent(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<{ enabled: boolean; acknowledgedAt: string }> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/copilot-consent`,
    jsonInit('POST', { acknowledge: true }),
    opts,
  )) as { enabled: boolean; acknowledged_at: string };
  return { enabled: wire.enabled, acknowledgedAt: wire.acknowledged_at };
}

export async function disableCopilotConsent(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<void> {
  await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/copilot-consent`,
    jsonInit('DELETE'),
    opts,
  );
}

// --- guide (R-M1) ------------------------------------------------------

export async function fetchGuideTopic(
  topic: string,
  opts: SettingsApiOptions = {},
): Promise<GuideTopic> {
  return (await request(
    `/api/v1/guide/${encodeURIComponent(topic)}`,
    jsonInit('GET'),
    opts,
  )) as GuideTopic;
}
