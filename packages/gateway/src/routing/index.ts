/**
 * Barrel for the routing module (FR-G2, FR-S3). NOTE: not re-exported from
 * packages/gateway/src/index.ts — that file is out of this ticket's
 * write_scope (packages/gateway/src/routing/**, packages/gateway/test/routing*
 * only), same gap W2-01/02/04 left for their own modules. A future ticket
 * that owns src/index.ts should add a `./routing` export. Tests are
 * co-located `*.test.ts` next to source per docs/TESTING.md §2 rather than
 * under packages/gateway/test/routing* — that glob is a single-segment `*`
 * (would not cover a nested dir) and every other gateway module already
 * co-locates, so this stays consistent (same call W2-01 made for
 * test/providers*).
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
  PRESET_ROLES,
  presetAsGlobalScope,
} from './presets.js';
export type { PresetName } from './presets.js';
