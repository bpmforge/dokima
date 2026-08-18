export type TaskType = 'reasoning' | 'code' | 'verification' | 'embed' | 'escalation';

export const TASK_TYPES: readonly TaskType[] = [
  'reasoning',
  'code',
  'verification',
  'embed',
  'escalation',
];

export interface ModelMatrixRow {
  role: string;
  taskType: TaskType;
  model: string;
  fallback: string[];
  updatedAt: string;
  copilotBacked: boolean;
}

export interface ModelMatrix {
  rows: ModelMatrixRow[];
  copilotEnabled: boolean;
}

export type AutonomyMode = 'interactive' | 'auto';

export interface NeverAutoItem {
  id: string;
  label: string;
  reason: string;
}

export interface AutonomySetting {
  mode: AutonomyMode;
  neverAuto: NeverAutoItem[];
}

export interface BreakerThresholds {
  warn: number;
  downshift: number;
  hardStop: number;
}

export interface BudgetSetting {
  runLimitUsd: number | null;
  projectLimitUsd: number | null;
  breakerThresholds: BreakerThresholds;
}

export type SettingsScope = 'run' | 'project' | 'global';

export interface EffectiveEntry {
  value: unknown;
  winningScope: SettingsScope;
  overridden: { scope: SettingsScope; value: unknown }[];
}

export type EffectiveSettings = Record<string, EffectiveEntry>;

export type SettingsMap = Record<string, unknown>;

export type RuleLifecycleState =
  'proposed' | 'shadow' | 'advisory' | 'gate' | 'deprecated';

export interface RuleState {
  ruleId: string;
  state: RuleLifecycleState;
  fpWindowFindings: number;
  fpWindowFps: number;
  fpRate: number;
  promotedAt: string | null;
  demotionFlagged: boolean;
  updatedAt: string;
}

export type SuppressionJustification =
  | 'false_positive'
  | 'not_applicable_scope'
  | 'accepted_risk'
  | 'fixed_elsewhere'
  | 'wont_fix_documented';

export const SUPPRESSION_JUSTIFICATIONS: readonly SuppressionJustification[] = [
  'false_positive',
  'not_applicable_scope',
  'accepted_risk',
  'fixed_elsewhere',
  'wont_fix_documented',
];

export interface Suppression {
  id: number;
  fingerprint: string;
  ruleId: string | null;
  justification: SuppressionJustification;
  signedBy: string;
  contextKey: string;
  status: 'active' | 'reopened';
  createdAt: string;
  reopenedAt: string | null;
}

export interface CopilotConsent {
  enabled: boolean;
  warning: string;
}

export interface GuideTopic {
  topic: string;
  markdown: string | null;
}

export type McpServerRegistration = {
  id: string;
  name: string;
  command: string;
  toolAllowlist: Record<string, string[]>;
};

export type ExpertOverride = {
  id: string;
  name: string;
  path: string;
  overrides: boolean;
};

// `pinned` mirrors the gateway union (W12-12) and is what D-024 option (b)
// stores. Redeclared, not imported, for the same reason the rest of this
// block is: apps/web is a browser bundle and cannot depend on apps/server.
export type EscalationPolicyMode = 'ladder' | 'locked' | 'token-gated' | 'pinned';
export type PolicyRung = 'R1' | 'R2' | 'R3';
export type TierKind = 'metered' | 'local';

export interface EscalationPolicySetting {
  mode: EscalationPolicyMode;
  pinnedTier?: PolicyRung;
  tierKind?: TierKind;
  namedTier?: PolicyRung;
  /** `pinned` only: the model that runs, and the kind whose ceiling applies (D-027). */
  model?: string;
  providerKind?: string;
}

export const MODEL_MATRIX_PRESETS = ['all-local', 'hybrid', 'all-cloud'] as const;
export type ModelMatrixPreset = (typeof MODEL_MATRIX_PRESETS)[number];

/**
 * W11-04 (FR-H6, D-023): which session runner a ticket session actually
 * uses. Redeclared here rather than imported — apps/web is a browser bundle
 * and cannot depend on apps/server (same reason `EscalationPolicySetting`/
 * `McpServerRegistration` above are redeclared, not imported); the
 * authoritative wire shape and copy live in
 * apps/server/src/api/server/settings-types.ts and must be kept in sync by
 * hand.
 */
export type AgentRunnerKind = 'built-in' | 'external';

export interface AgentRunnerSetting {
  kind: AgentRunnerKind;
  command?: string;
}

export const AGENT_RUNNER_SETTINGS_KEY = 'agentRunner';

export const DEFAULT_AGENT_RUNNER_SETTING: AgentRunnerSetting = { kind: 'built-in' };

/** What picking `external` gives up (acceptance 2) — same copy as the server's `EXTERNAL_AGENT_WARNING`, shown where the choice is made. */
export const EXTERNAL_AGENT_WARNING =
  "An external agent CLI runs outside Dokima's gateway, so its tokens are " +
  'spent somewhere Dokima cannot see. Choosing it gives up: the role→model ' +
  'matrix (FR-G2), the escalation ladder (D-018), the budget breakers ' +
  '(FR-G4), and the spend ledger — none of them apply to what an external ' +
  'CLI does.';
