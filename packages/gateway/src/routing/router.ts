/**
 * The combined entry point future gateway tickets call (escalation ladder,
 * budget service): resolves a (role, taskType) call to a model chain and,
 * when the role is a verifier role, enforces maker != verifier (FR-G2).
 *
 * The guard is structural, not caller-triggered: routing any VERIFIER_ROLES
 * role always resolves the maker role (default 'coding-agent') for the
 * same task type from the same matrix and compares. A caller cannot
 * silently skip the refusal by omitting a parameter — the only way past a
 * collision is the explicit override setting guardMakerVerifierDistinct
 * checks (FR-G2: "override requires explicit setting + event").
 */

import {
  guardMakerVerifierDistinct,
  isVerifierRole,
  type MakerVerifierOverrideEvent,
  type RoutingEventSink,
} from './maker-verifier.js';
import { resolveModelChain, type ResolvedRoute } from './matrix.js';
import {
  ROLE_CODING_AGENT,
  type AgentRole,
  type ScopedOverrideSettings,
  type ScopedRoleMatrix,
  type TaskType,
} from './types.js';

export interface RouteRequest {
  readonly matrix: ScopedRoleMatrix;
  readonly role: AgentRole;
  readonly taskType: TaskType;
  readonly actorId: string;
  /** The maker role to guard a verifier role against; only consulted when `role` is a verifier role (default: 'coding-agent'). */
  readonly makerRole?: AgentRole;
  readonly overrideSettings?: ScopedOverrideSettings;
  readonly sink?: RoutingEventSink;
}

export interface RouteResult extends ResolvedRoute {
  readonly overrideEvent?: MakerVerifierOverrideEvent;
}

/** Resolves a (role, taskType) call to a model chain, enforcing the maker != verifier default (FR-G2). */
export async function route(request: RouteRequest): Promise<RouteResult> {
  const resolved = resolveModelChain(request.matrix, request.role, request.taskType);
  if (!isVerifierRole(request.role)) return resolved;

  const makerRole = request.makerRole ?? ROLE_CODING_AGENT;
  const makerResolved = resolveModelChain(request.matrix, makerRole, request.taskType);

  const overrideEvent = await guardMakerVerifierDistinct({
    verifierRole: request.role,
    makerRole,
    taskType: request.taskType,
    verifierModel: resolved.chain[0]!,
    makerModel: makerResolved.chain[0]!,
    overrideSettings: request.overrideSettings,
    actorId: request.actorId,
    sink: request.sink,
  });
  return { ...resolved, overrideEvent };
}
