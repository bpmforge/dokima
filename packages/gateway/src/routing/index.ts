/**
 * Barrel for the routing module (FR-G2, FR-S3). Re-exported from
 * packages/gateway/src/index.ts (`export * from './routing/index.js'`,
 * W10-01) — callers outside this package import it bare as
 * `from '@dokima/gateway'` (apps/server does this in six files as of
 * W10-42). package.json also declares a `./routing` subpath, but DO NOT
 * import it (`from '@dokima/gateway/routing'`): eslint.config.js's
 * DEEP_IMPORT_REGEX (`^@dokima/[^/]+/.+`) bans every deep import across a
 * package boundary repo-wide, no escape hatch — this cost attempt 1 of
 * W10-42 a full session chasing that exact import. The bare barrel import
 * is the only legal path in or out of this module. Tests are co-located
 * `*.test.ts` next to source per docs/TESTING.md §2 rather than under
 * packages/gateway/test/routing* — that glob is a single-segment `*`
 * (would not cover a nested dir) and every other gateway module already
 * co-locates, so this stays consistent (same call W2-01 made for
 * test/providers*).
 *
 * Granularity note: docs/API_DESIGN.md's settings endpoints resolve keys
 * generically (`GET /projects/{id}/settings/effective` -> every key ->
 * {value, winning_scope}) and don't pin a specific shape for the matrix
 * key itself. This module resolves atomically per *role* (a scope either
 * owns a role's whole RoleRouting — default + all task-type overrides —
 * or it doesn't; no merging of individual task-type cells across scopes).
 * A future ticket wiring this into the real settings/events APIs should
 * either confirm that granularity or, if the API lands on a finer
 * per-(role,taskType) key, adjust ScopedRoleMatrix accordingly.
 */

export {
  DEFAULT_ROLE,
  ROLE_CHALLENGER,
  ROLE_CODE_REVIEWER,
  ROLE_CODING_AGENT,
  ROLE_PM_INTERVIEWER,
  ROLE_TEST_ENGINEER,
  ROUTING_SCOPE_PRECEDENCE,
  TASK_TYPES,
  VERIFIER_ROLES,
} from './types.js';
export type {
  AgentRole,
  ModelAssignment,
  RoleMatrix,
  RoleRouting,
  RoutingScope,
  ScopedOverrideSettings,
  ScopedRoleMatrix,
  TaskType,
  ThreeScopeMap,
} from './types.js';

export {
  RoutingUnresolvedError,
  resolveModelChain,
  resolveRoleRouting,
  resolveScopedValue,
} from './matrix.js';
export type { ResolvedRoleRouting, ResolvedRoute, ScopedResolution } from './matrix.js';

export {
  SameModelRefusedError,
  createInMemoryRoutingEventSink,
  guardMakerVerifierDistinct,
  isVerifierRole,
  noopRoutingEventSink,
} from './maker-verifier.js';
export type {
  MakerVerifierGuardInput,
  MakerVerifierOverrideEvent,
  RoutingEventSink,
} from './maker-verifier.js';

export { route } from './router.js';
export type { RouteRequest, RouteResult } from './router.js';

export {
  PRESETS,
  PRESET_ALL_CLOUD,
  PRESET_ALL_LOCAL,
  PRESET_HYBRID,
  PRESET_NAMES,
  PRESET_ROLES,
  presetAsGlobalScope,
} from './presets.js';
export type { PresetName } from './presets.js';
