/**
 * Effective model resolution for the roster (SRS FR-E2 "effective model
 * resolution with winning scope (FR-S1 style)"). Each expert's filename
 * stem doubles as its `AgentRole` for routing purposes — an open-ended
 * string per `packages/gateway/src/routing/types.ts`'s own design ("Agent
 * roles are open-ended (editable in Settings)"), falling back to the
 * `'default'` role exactly as `packages/gateway`'s matrix resolver does.
 *
 * `apps/server` cannot depend on `packages/gateway` (not a declared
 * dependency, and `apps/server/package.json` sits outside this ticket's
 * write_scope), so the shipped `RoleRouting`/`ScopedRoleMatrix` types
 * aren't reachable here. Rather than re-deriving `packages/shared`'s
 * run>project>global precedence locally (the class of duplication
 * `packages/gateway/src/routing/matrix.ts` had to accept only because *it*
 * lacks a `packages/shared` dependency), this reuses
 * `@shipwright/shared`'s `resolveEffectiveValue` directly — `apps/server`
 * already depends on `@shipwright/shared` — storing each role's assignment
 * under its own flat settings key (`roleMatrix.<role>`) so the existing
 * atomic per-key resolution (no deep merge across scopes, FR-S1) applies
 * without any local reimplementation. `.shipwright/settings.json`'s
 * "matrix overrides" (FR-S1) are expected to eventually populate this same
 * key shape once W4-06 (settings wizard+UI, currently blocked) lands.
 *
 * No project has a matrix configured anywhere yet (W4-06 blocked, and
 * `packages/gateway`'s shipped presets aren't reachable to seed a default)
 * — every expert honestly resolves to "unconfigured" (`scope: null`) until
 * a real matrix is written, per C-1 (never fabricate a plausible-looking
 * chain).
 */

import {
  resolveEffectiveValue,
  type JsonValue,
  type ScopedSettings,
} from '@shipwright/shared';

export const DEFAULT_ROSTER_ROLE = 'default';

export interface ModelAssignment {
  readonly model: string;
  readonly fallbackChain: readonly string[];
}

export type RosterScope = 'run' | 'project' | 'global';

export interface EffectiveModelResolution {
  readonly role: string;
  /** Primary model followed by its fallback chain; empty when unconfigured. */
  readonly chain: readonly string[];
  /** The scope whose value won, or null when no scope defines a matrix entry for this role or 'default'. */
  readonly scope: RosterScope | null;
  /** true when this role fell through to the 'default' role because it had no entry of its own. */
  readonly usedDefaultRole: boolean;
}

export function roleMatrixSettingsKey(role: string): string {
  return `roleMatrix.${role}`;
}

function isPlainObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toAssignment(value: JsonValue): ModelAssignment | undefined {
  if (!isPlainObject(value)) return undefined;
  const model = value.model;
  if (typeof model !== 'string' || model.trim() === '') return undefined;
  const fallbackChainRaw = value.fallbackChain;
  const fallbackChain = Array.isArray(fallbackChainRaw)
    ? fallbackChainRaw.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { model, fallbackChain };
}

const UNCONFIGURED: Omit<EffectiveModelResolution, 'role'> = {
  chain: [],
  scope: null,
  usedDefaultRole: false,
};

/** Resolves a role's effective model chain + winning scope (FR-S1 style), falling back to 'default' when unset. */
export function resolveEffectiveModel(
  settings: ScopedSettings,
  role: string,
): EffectiveModelResolution {
  const direct = resolveEffectiveValue(roleMatrixSettingsKey(role), settings);
  if (direct) {
    const assignment = toAssignment(direct.value);
    if (assignment) {
      return {
        role,
        chain: [assignment.model, ...assignment.fallbackChain],
        scope: direct.scope,
        usedDefaultRole: false,
      };
    }
  }

  if (role === DEFAULT_ROSTER_ROLE) return { role, ...UNCONFIGURED };

  const fallback = resolveEffectiveValue(
    roleMatrixSettingsKey(DEFAULT_ROSTER_ROLE),
    settings,
  );
  if (!fallback) return { role, ...UNCONFIGURED };
  const assignment = toAssignment(fallback.value);
  if (!assignment) return { role, ...UNCONFIGURED };
  return {
    role,
    chain: [assignment.model, ...assignment.fallbackChain],
    scope: fallback.scope,
    usedDefaultRole: true,
  };
}
