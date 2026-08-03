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

export type EscalationPolicyMode = 'ladder' | 'locked' | 'token-gated';
export type PolicyRung = 'R1' | 'R2' | 'R3';
export type TierKind = 'metered' | 'local';

export interface EscalationPolicySetting {
  mode: EscalationPolicyMode;
  pinnedTier?: PolicyRung;
  tierKind?: TierKind;
  namedTier?: PolicyRung;
}

/**
 * Mirrors `packages/gateway/src/routing/presets.ts`'s `PRESET_NAMES` (that
 * module's `Object.keys(PRESETS)`, W10-42) — apps/web has no dependency on
 * `@dokima/gateway` (out of this ticket's write_scope to add, and
 * ARCHITECTURE §4: the web app talks to the server over REST/WS only,
 * never a domain package directly), so this module owns its own copy
 * rather than importing it, same precedent as `apps/web/src/board/types.ts`
 * and `apps/web/src/onboarding/types.ts`.
 */
export const MODEL_MATRIX_PRESETS = ['all-local', 'hybrid', 'all-cloud'] as const;
export type ModelMatrixPreset = (typeof MODEL_MATRIX_PRESETS)[number];
