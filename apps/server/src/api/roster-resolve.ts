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
 * `@dokima/shared`'s `resolveEffectiveValue` directly — `apps/server`
 * already depends on `@dokima/shared` — storing each role's assignment
 * under its own flat settings key (`roleMatrix.<role>`) so the existing
 * atomic per-key resolution (no deep merge across scopes, FR-S1) applies
 * without any local reimplementation. The stored value's shape is a
 * `{default: {model, fallbackChain}}` envelope matching
 * `packages/gateway/src/routing/types.ts`'s `RoleRouting` exactly (minus
 * `taskTypes`, which a static per-role browse view has no call site to
 * select by) — so a real `RoleRouting` object, gateway-produced or
 * hand-written, can be dropped into this settings key unchanged once
 * W4-06 (settings wizard+UI, currently blocked) or the gateway itself
 * writes here; this file only ever reads `.default`.
 *
 * W13-57: the paragraph that used to end this header said "no project has
 * a matrix configured anywhere yet" — true when written, and the settings
 * key this file reads was the ONLY store then. The real matrix landed in
 * `model-matrix-store.ts` (SQLite, the store `route()` and the wizard both
 * use) and this reader was never rewired, so on a fully configured install
 * every expert still claimed "needs a model" — a false statement the W13-49
 * roster cleanup made prominent. `resolveEffectiveModelFromSources` below
 * layers the two: the settings envelope stays as the higher-precedence
 * override it was designed to be, and the matrix rows are the ground truth
 * beneath it.
 */

import {
  resolveEffectiveValue,
  type JsonValue,
  type ScopedSettings,
} from '@dokima/shared';

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

function isPlainObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the `{default: {model, fallbackChain}}` envelope — the `RoleRouting` shape, `.default` only. */
function toAssignment(value: JsonValue): ModelAssignment | undefined {
  if (!isPlainObject(value)) return undefined;
  const def = value.default;
  if (!isPlainObject(def)) return undefined;
  const model = def.model;
  if (typeof model !== 'string' || model.trim() === '') return undefined;
  const fallbackChainRaw = def.fallbackChain;
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

/** The matrix-store row shape this module needs — structural, so `apps/server`'s settings-types row satisfies it unchanged. */
export interface MatrixRowLike {
  readonly role: string;
  readonly taskType: string;
  readonly model: string;
  readonly fallback: readonly string[];
}

/** Prefers the role's 'code' row (the roster is a per-role browse; code is the run's default task type), else its first row. */
function rowFor(rows: readonly MatrixRowLike[], role: string): MatrixRowLike | undefined {
  const mine = rows.filter((row) => row.role === role);
  return mine.find((row) => row.taskType === 'code') ?? mine[0];
}

/**
 * Resolution against BOTH sources (W13-57): the `roleMatrix.<role>` settings
 * override first (unchanged precedence), then the real matrix rows — project
 * rows shadowing global exactly as `listModelMatrix` already merged them,
 * with the same default-role fallback `route()` applies. `ownRows` is the
 * project's own row set, used only to report WHERE the winning row lives.
 */
export function resolveEffectiveModelFromSources(
  settings: ScopedSettings,
  rows: readonly MatrixRowLike[],
  ownRows: readonly MatrixRowLike[],
  role: string,
): EffectiveModelResolution {
  const fromSettings = resolveEffectiveModel(settings, role);
  if (fromSettings.scope !== null) return fromSettings;

  const scopeOf = (row: MatrixRowLike): RosterScope =>
    ownRows.some((own) => own.role === row.role && own.taskType === row.taskType)
      ? 'project'
      : 'global';

  const direct = rowFor(rows, role);
  if (direct) {
    return {
      role,
      chain: [direct.model, ...direct.fallback],
      scope: scopeOf(direct),
      usedDefaultRole: false,
    };
  }
  const fallback = role === DEFAULT_ROSTER_ROLE ? undefined : rowFor(rows, DEFAULT_ROSTER_ROLE);
  if (!fallback) return { role, ...UNCONFIGURED };
  return {
    role,
    chain: [fallback.model, ...fallback.fallback],
    scope: scopeOf(fallback),
    usedDefaultRole: true,
  };
}
