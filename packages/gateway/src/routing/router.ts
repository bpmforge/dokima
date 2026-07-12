/**
 * The combined entry point future gateway tickets call (escalation ladder,
 * budget service): resolves a (role, taskType) call to a model chain and,
 * when the role is a verifier role, enforces maker != verifier (FR-G2).
 */

import {
  guardMakerVerifierDistinct,
  type MakerVerifierOverrideEvent,
  type RoutingEventSink,
} from './maker-verifier.js';
import { resolveModelChain, type ResolvedRoute } from './matrix.js';
import type {
  AgentRole,
  ScopedOverrideSettings,
  ScopedRoleMatrix,
  TaskType,
} from './types.js';

export interface RouteRequest {
  readonly matrix: ScopedRoleMatrix;
  readonly role: AgentRole;
  readonly taskType: TaskType;
  readonly actorId: string;
  /** Required to run the maker != verifier guard when `role` is a verifier role; ignored otherwise. */
  readonly makerRole?: AgentRole;
  readonly makerModel?: string;
  readonly overrideSettings?: ScopedOverrideSettings;
  readonly sink?: RoutingEventSink;
}

export interface RouteResult extends ResolvedRoute {
  readonly overrideEvent?: MakerVerifierOverrideEvent;
}

/** Resolves a (role, taskType) call to a model chain, enforcing the maker != verifier default (FR-G2). */
export async function route(request: RouteRequest): Promise<RouteResult> {
  const resolved = resolveModelChain(request.matrix, request.role, request.taskType);
  if (request.makerRole === undefined || request.makerModel === undefined) {
    return resolved;
  }

  const primaryModel = resolved.chain[0];
  if (primaryModel === undefined) return resolved;

  const overrideEvent = await guardMakerVerifierDistinct({
    verifierRole: request.role,
    makerRole: request.makerRole,
    taskType: request.taskType,
    verifierModel: primaryModel,
    makerModel: request.makerModel,
    overrideSettings: request.overrideSettings,
    actorId: request.actorId,
    sink: request.sink,
  });
  return { ...resolved, overrideEvent };
}
