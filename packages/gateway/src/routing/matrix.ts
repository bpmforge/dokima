/**
 * Role matrix resolution (FR-G2, FR-S1): resolves a (role, task-type) call
 * to a model + fallback chain from the three-scope matrix, falling back to
 * the 'default' role when the caller's role has no entry of its own
 * (BLUEPRINT §3.3: `default -> cheapest-capable`).
 */

import {
  DEFAULT_ROLE,
  ROUTING_SCOPE_PRECEDENCE,
  type AgentRole,
  type ModelAssignment,
  type RoleRouting,
  type RoutingScope,
  type ScopedRoleMatrix,
  type TaskType,
  type ThreeScopeMap,
} from './types.js';

export interface ScopedResolution<T> {
  readonly value: T;
  readonly scope: RoutingScope;
}

/** Generic run>project>global resolver (FR-S1) shared by the role matrix and override settings. */
export function resolveScopedValue<T>(
  scopes: ThreeScopeMap<T>,
  role: AgentRole,
): ScopedResolution<T> | undefined {
  for (const scope of ROUTING_SCOPE_PRECEDENCE) {
    const value = scopes[scope]?.[role];
    if (value !== undefined) return { value, scope };
  }
  return undefined;
}

/** Thrown when neither the requested role nor the 'default' role is defined in any scope. */
export class RoutingUnresolvedError extends Error {
  constructor(
    public readonly role: AgentRole,
    public readonly taskType: TaskType,
  ) {
    super(
      `no route for role '${role}' (task type '${taskType}') and no 'default' role fallback is defined in any scope`,
    );
    this.name = 'RoutingUnresolvedError';
  }
}

export interface ResolvedRoleRouting extends ScopedResolution<RoleRouting> {
  /** true when this role fell through to the 'default' role because it had no entry of its own. */
  readonly usedDefaultRole: boolean;
}

/** Resolves the role's routing entry, falling back to the 'default' role when unset. */
export function resolveRoleRouting(
  matrix: ScopedRoleMatrix,
  role: AgentRole,
): ResolvedRoleRouting | undefined {
  const direct = resolveScopedValue(matrix, role);
  if (direct) return { ...direct, usedDefaultRole: false };
  if (role === DEFAULT_ROLE) return undefined;
  const fallback = resolveScopedValue(matrix, DEFAULT_ROLE);
  return fallback ? { ...fallback, usedDefaultRole: true } : undefined;
}

export interface ResolvedRoute {
  readonly role: AgentRole;
  readonly taskType: TaskType;
  /** Primary model followed by its fallback chain, in try-order. */
  readonly chain: readonly string[];
  /** The scope whose matrix entry won (FR-S1: "why is this role on this model?"). */
  readonly scope: RoutingScope;
  readonly usedDefaultRole: boolean;
}

/** Resolves the (role, taskType) cell to a model + fallback chain (FR-G2). */
export function resolveModelChain(
  matrix: ScopedRoleMatrix,
  role: AgentRole,
  taskType: TaskType,
): ResolvedRoute {
  const resolved = resolveRoleRouting(matrix, role);
  if (!resolved) throw new RoutingUnresolvedError(role, taskType);
  const assignment: ModelAssignment =
    resolved.value.taskTypes?.[taskType] ?? resolved.value.default;
  return {
    role,
    taskType,
    chain: [assignment.model, ...assignment.fallbackChain],
    scope: resolved.scope,
    usedDefaultRole: resolved.usedDefaultRole,
  };
}
