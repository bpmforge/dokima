/**
 * Role -> model routing types (FR-G2, FR-S3, BLUEPRINT §3.3/§3.10): the role
 * matrix (agent role -> model + fallback chain) and task-type routing
 * within a role's calls, resolved from a three-scope settings model
 * (run > project > global, FR-S1) at per-role granularity — the same
 * atomic-value-wins, no-deep-merge rule packages/shared's settings
 * resolver uses. packages/gateway has no workspace dependency on
 * packages/shared within this ticket's write_scope (packages/gateway's own
 * package.json is out of scope, so the dependency can't be declared), so
 * the precedence algorithm is reimplemented locally rather than imported —
 * see the HANDOFF note in index.ts.
 */

export type TaskType = 'reasoning' | 'code' | 'verification' | 'embed' | 'escalation';

export const TASK_TYPES: readonly TaskType[] = [
  'reasoning',
  'code',
  'verification',
  'embed',
  'escalation',
];

/** Agent roles are open-ended (editable in Settings) — 'default' is the mandatory catch-all. */
export type AgentRole = string;

export const DEFAULT_ROLE: AgentRole = 'default';

/** Canonical role names from BLUEPRINT §3.3's worked example; the shipped presets use these. */
export const ROLE_CODING_AGENT: AgentRole = 'coding-agent';
export const ROLE_CODE_REVIEWER: AgentRole = 'code-reviewer';
export const ROLE_CHALLENGER: AgentRole = 'challenger';
export const ROLE_TEST_ENGINEER: AgentRole = 'test-engineer';
export const ROLE_PM_INTERVIEWER: AgentRole = 'pm-interviewer';

/** Roles that verify another agent's work — the maker's model is refused here by default (FR-G2). */
export const VERIFIER_ROLES: readonly AgentRole[] = [ROLE_CODE_REVIEWER, ROLE_CHALLENGER];

export interface ModelAssignment {
  readonly model: string;
  /** Ordered try-next chain after the primary model; not subject to the maker!=verifier guard (last-resort degradation). */
  readonly fallbackChain: readonly string[];
}

/** One role's routing: a default assignment plus optional per-task-type overrides. */
export interface RoleRouting {
  readonly default: ModelAssignment;
  readonly taskTypes?: Partial<Record<TaskType, ModelAssignment>>;
}

export type RoleMatrix = Record<AgentRole, RoleRouting>;

export type RoutingScope = 'run' | 'project' | 'global';

/** run > project > global (FR-S1, mirrored from packages/shared's SCOPE_PRECEDENCE). */
export const ROUTING_SCOPE_PRECEDENCE: readonly RoutingScope[] = [
  'run',
  'project',
  'global',
];

/**
 * A value keyed by agent role across the three scopes. Resolution is
 * atomic per role — the winning scope's whole value wins outright, never
 * merged with a lower scope's value for the same role (FR-S1).
 */
export interface ThreeScopeMap<T> {
  readonly global?: Partial<Record<AgentRole, T>>;
  readonly project?: Partial<Record<AgentRole, T>>;
  readonly run?: Partial<Record<AgentRole, T>>;
}

export type ScopedRoleMatrix = ThreeScopeMap<RoleRouting>;

/** Explicit per-role override permitting a verifier role to land on the maker's model (FR-G2). */
export type ScopedOverrideSettings = ThreeScopeMap<boolean>;
