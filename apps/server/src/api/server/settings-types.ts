/**
 * Local type definitions mirroring packages/gateway's routing/escalation/fitness
 * shapes and packages/loop's rule-lifecycle shapes (D-018, D-014, FR-G2, FR-S1).
 * STALE CLAIM CORRECTED (W11-04): this docstring used to say apps/server
 * could not depend on packages/gateway or packages/loop because neither was
 * a declared workspace dependency — both are, as of `apps/server/package.json`
 * today (confirmed: `run-build.ts` in this same package imports real types
 * and functions from both). These types remain a deliberate, DOCUMENTED
 * duplication of the wire shape those packages already define
 * (packages/gateway/src/routing/types.ts, escalation/policy-types.ts,
 * packages/loop/src/findings-types.ts/findings-rules.ts) — nobody has done
 * the consolidation pass yet, not because the dependency boundary forbids
 * it. A future ticket should replace these with real imports.
 */

export type AgentRole = string;

export type TaskType = 'reasoning' | 'code' | 'verification' | 'embed' | 'escalation';

export const TASK_TYPES: readonly TaskType[] = [
  'reasoning',
  'code',
  'verification',
  'embed',
  'escalation',
];

export interface ModelMatrixRow {
  readonly role: AgentRole;
  readonly taskType: TaskType;
  /** Which provider this row means (W10-68). Absent keeps the pre-ticket meaning: bind to the single enabled provider, ambiguous if several. */
  readonly providerId?: string;
  readonly model: string;
  readonly fallback: readonly string[];
  readonly updatedAt: string;
}

export type ModelMatrixPreset = 'all-local' | 'hybrid' | 'all-cloud';

export const MODEL_MATRIX_PRESETS: readonly ModelMatrixPreset[] = [
  'all-local',
  'hybrid',
  'all-cloud',
];

export type SettingsScope = 'global' | 'project' | 'run';

/** run > project > global (FR-S1), same precedence packages/shared's settings.ts uses. */
export const SCOPE_PRECEDENCE: readonly SettingsScope[] = ['run', 'project', 'global'];

export type AutonomyMode = 'interactive' | 'auto';

export interface NeverAutoItem {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

/** Immutable, non-editable (BLUEPRINT §3.1.4, SC-10) — mirrors the product-level list, distinct from the agent-authoring AUTONOMY_PROTOCOL.md NA-1..NA-7 table. */
export const NEVER_AUTO_LIST: readonly NeverAutoItem[] = [
  {
    id: 'interviews',
    label: 'Discovery / feature interviews',
    reason: 'These ARE user input — there is no default to take.',
  },
  {
    id: 'destructive-db',
    label: 'Destructive database operations',
    reason: 'Irreversible.',
  },
  {
    id: 'merges-releases-deploys',
    label: 'Merges to main, releases, tags, deploys',
    reason: 'Outward-facing / irreversible.',
  },
  {
    id: 'tech-stack-additions',
    label: 'New tech-stack additions',
    reason: 'Changes the approved design surface.',
  },
  {
    id: 'auth-crypto-changes',
    label: 'Auth / crypto security-behavior changes',
    reason: 'Behavior-changing; needs human review.',
  },
  {
    id: 'scope-boundary-breaks',
    label: 'Scope-boundary breaks',
    reason: 'The task was mis-routed; proceeding would be wrong work.',
  },
];

export interface BudgetLimits {
  readonly runLimitUsd?: number;
  readonly projectLimitUsd?: number;
}

/** FR-G4's 70/85/100% circuit-breaker thresholds (matches packages/gateway/src/budget/types.ts's BREAKER_THRESHOLDS). */
export const BREAKER_THRESHOLDS = { warn: 0.7, downshift: 0.85, hardStop: 1.0 } as const;

export interface McpServerRegistration {
  readonly id: string;
  readonly name: string;
  /** Launch command or URL — kept opaque; the MCP host that executes it is W6-04's job. */
  readonly command: string;
  /** Per-role tool allowlist (FR-I3): a role absent here cannot see any of this server's tools. */
  readonly toolAllowlist: Readonly<Partial<Record<AgentRole, readonly string[]>>>;
}

export interface ExpertOverride {
  readonly id: string;
  readonly name: string;
  /** Project-local markdown path (relative to the project dir). */
  readonly path: string;
  /** true = overrides a core content/experts/** entry sharing this id; false = a pure addition. */
  readonly overrides: boolean;
}

export type EscalationPolicyMode = 'ladder' | 'locked' | 'token-gated';
export type PolicyRung = 'R1' | 'R2' | 'R3';
export type TierKind = 'metered' | 'local';

export interface EscalationPolicySetting {
  readonly mode: EscalationPolicyMode;
  readonly pinnedTier?: PolicyRung;
  readonly tierKind?: TierKind;
  readonly namedTier?: PolicyRung;
}

export const CONVERGENCE_CEILING: Readonly<Record<TierKind, number>> = {
  metered: 8,
  local: 12,
};

export type RuleLifecycleState =
  'proposed' | 'shadow' | 'advisory' | 'gate' | 'deprecated';

export const RULE_LIFECYCLE_ORDER: readonly RuleLifecycleState[] = [
  'proposed',
  'shadow',
  'advisory',
  'gate',
  'deprecated',
];

export interface RuleStateRow {
  readonly ruleId: string;
  readonly state: RuleLifecycleState;
  readonly fpWindowFindings: number;
  readonly fpWindowFps: number;
  /** Derived: fpWindowFps / fpWindowFindings, 0 when no findings observed yet. */
  readonly fpRate: number;
  readonly promotedAt: string | null;
  readonly demotionFlagged: boolean;
  readonly updatedAt: string;
}

/** Trailing FP rate above this on a `gate`-state rule auto-flags demotion (matches packages/loop/src/findings-rules.ts). */
export const DEMOTION_FP_THRESHOLD = 0.5;

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

export interface SuppressionRow {
  readonly id: number;
  readonly fingerprint: string;
  readonly ruleId: string | null;
  readonly justification: SuppressionJustification;
  readonly signedBy: string;
  readonly contextKey: string;
  readonly status: 'active' | 'reopened';
  readonly createdAt: string;
  readonly reopenedAt: string | null;
}

/**
 * W11-04 (FR-H6, D-023): which session runner a ticket session actually
 * uses. No dedicated route — like `mcpServers`/`escalationPolicy` above,
 * this is a generic settings key (`AGENT_RUNNER_SETTINGS_KEY`) read/written
 * through `GET/PUT /projects/{id}/settings` and `GET/PUT /settings/global`
 * (scope-routes.ts), resolved run>project>global by the same
 * `getEffectiveProjectSettings` every other typed panel here uses.
 *
 * `built-in` (the default — D-023: Dokima runs its own agent sessions,
 * through the gateway) needs no `command`. `external` is the escape hatch
 * for an agent CLI the operator already trusts (`--agent-command`'s old
 * CLI-only shape) and MUST be typed in explicitly — there is no default
 * external command, because picking one spends real tokens somewhere
 * Dokima cannot meter.
 */
export type AgentRunnerKind = 'built-in' | 'external';

export interface AgentRunnerSetting {
  readonly kind: AgentRunnerKind;
  /**
   * `<bin> [args...]`, run once per ticket session with the handoff as its
   * final argument — same shape `--agent-command` always took. Required
   * when `kind === 'external'`; the type doesn't enforce that (an
   * empty/missing `command` alongside `kind: 'external'` is a valid,
   * constructible value of this interface), because `parseAgentRunnerSetting`
   * deliberately preserves that exact shape as a MISCONFIGURED row rather
   * than degrading it — see that function's docstring (W11-18).
   */
  readonly command?: string;
}

/** The generic settings key this setting lives under (scope-routes.ts's flat key/value store). */
export const AGENT_RUNNER_SETTINGS_KEY = 'agentRunner';

export const DEFAULT_AGENT_RUNNER_SETTING: AgentRunnerSetting = { kind: 'built-in' };

/**
 * What picking `external` gives up (acceptance 2): stated where the choice
 * is made, not just in a code comment — an external CLI's tokens are spent
 * somewhere Dokima cannot see, so none of the machinery that depends on
 * seeing them can apply.
 */
export const EXTERNAL_AGENT_WARNING =
  "An external agent CLI runs outside Dokima's gateway, so its tokens are " +
  'spent somewhere Dokima cannot see. Choosing it gives up: the role→model ' +
  'matrix (FR-G2), the escalation ladder (D-018), the budget breakers ' +
  '(FR-G4), and the spend ledger — none of them apply to what an external ' +
  'CLI does.';

/**
 * Longest `command` this parser treats as a legitimate `<bin> [args...]`
 * invocation (W11-20, C-2/C-3, FR-S2). `resolveAgentRunner` (run-build.ts)
 * spawns this string verbatim as the host process on every subsequent
 * build run — picking the binary is a strictly bigger decision than
 * `copilotEnabled` (scope-routes.ts's `CONSENT_GATED_KEYS`), which already
 * gets a gate, and this had none. Comfortably above any real CLI
 * invocation; exists only to cap how much a caller can push into this
 * setting, same spirit as the shell-metacharacter check below.
 */
const AGENT_RUNNER_COMMAND_MAX_LENGTH = 4096;

/**
 * `run-build.ts` builds argv by `command.split(' ').filter(Boolean)` and
 * passes the result to `child_process.spawn` with no shell (`createChild
 * ProcessSpawn`, packages/loop/src/session.ts) — so none of these chars are
 * exploitable *today*. The check exists anyway (acceptance 3/5): a value
 * containing one can never be a legitimate short CLI invocation, and
 * refusing it is cheap insurance against a future caller that does invoke
 * a shell. Backslash is deliberately excluded — it is load-bearing in a
 * Windows path (`C:\bin\opencode.exe`) and spawn never hands argv to a
 * shell that would treat it specially.
 *
 * Chose this blocklist over an operator allowlist (acceptance 3 offers
 * either): `external` is explicitly the escape hatch for "an agent CLI the
 * operator already trusts" (this file's `AgentRunnerKind` doc) — there is
 * no fixed set of trusted binaries to enumerate, so an allowlist here would
 * either be unusably narrow or fake.
 */
const SHELL_METACHARACTERS = /[;&|`$()<>\r\n*?~#!'"]/;

function isMisconfiguredExternalCommand(command: string): boolean {
  return (
    command.length > AGENT_RUNNER_COMMAND_MAX_LENGTH || SHELL_METACHARACTERS.test(command)
  );
}

/**
 * Narrows an effective settings value (untyped `JsonValue`) to a valid
 * `AgentRunnerSetting`. Two failure shapes get different treatment
 * (W11-18, FR-H6) — NOT-CONFIGURED vs MISCONFIGURED are different claims
 * about what the user chose:
 *
 * - NOT-CONFIGURED: no stored value, a malformed non-object/array/null, or
 *   an unrecognized `kind` — nobody made an `external` choice at all, so
 *   this degrades to the built-in default, same "unreadable setting must
 *   not take the surface down" posture `providers-store.ts`'s
 *   `listProviders` uses rather than throwing on a hand-edited or stale
 *   settings file. This is W11-04's ruling and is unchanged here.
 * - MISCONFIGURED: `kind === 'external'` was explicitly chosen but
 *   `command` is empty, whitespace-only, missing, too long, or carries a
 *   shell metacharacter (W11-20). This is NOT degraded to built-in — the
 *   row is returned as-is (`command` normalized to `''` for any of those
 *   cases) so the caller sees the choice that was made and can refuse on
 *   it, matching the W10-77 contract for a genuinely broken external
 *   command (`executeBuildRun` already refuses on an empty `agentBin`, so
 *   normalizing an oversized/unsafe command to `''` reuses that same
 *   refusal rather than a new one). Silently substituting the built-in
 *   agent here would hand the user a different agent than the one they
 *   picked, with no signal — the inverse of what `EXTERNAL_AGENT_WARNING`
 *   exists for.
 */
export function parseAgentRunnerSetting(value: unknown): AgentRunnerSetting {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_AGENT_RUNNER_SETTING;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'built-in') return { kind: 'built-in' };
  if (kind === 'external') {
    const command = (value as { command?: unknown }).command;
    const normalized = typeof command === 'string' ? command : '';
    return {
      kind: 'external',
      command: isMisconfiguredExternalCommand(normalized) ? '' : normalized,
    };
  }
  return DEFAULT_AGENT_RUNNER_SETTING;
}

// Chapter module (CODE_BOOK_PROTOCOL 400-line cap, split the day it was
// added): the `mcpServers` schema + parser live in settings-mcp.ts; this
// re-export keeps the one-import convention for settings shapes.
export {
  MCP_SERVERS_SETTINGS_KEY,
  parseMcpServersSetting,
} from './settings-mcp.js';
export type { McpServerSetting, McpServersParseResult } from './settings-mcp.js';
