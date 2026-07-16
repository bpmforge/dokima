/**
 * The combined entry point future gateway tickets call (escalation ladder,
 * budget service): resolves a (role, taskType) call to a model chain,
 * enforces maker != verifier for verifier roles (FR-G2), and enforces the
 * fitness guard for every role (FR-G6).
 *
 * Both guards are structural, not caller-triggered: the maker!=verifier
 * check always runs for a VERIFIER_ROLES role, and guardFitAssignment
 * always runs for every route() call — `fitnessStore` is a *required*
 * RouteRequest field precisely so a caller cannot silently skip the
 * fitness check by omitting a parameter, mirroring how the maker!=verifier
 * guard cannot be skipped by omitting `makerRole`. The only way past
 * either refusal is the explicit override each guard itself defines
 * (guardMakerVerifierDistinct's overrideSettings; guardFitAssignment's
 * ack) — never a missing argument.
 */

import {
  guardFitAssignment,
  type GuardFitAssignmentResult,
} from '../fitness/assignment.js';
import type { FitnessAckEvent, FitnessEventSink } from '../fitness/events.js';
import type { FitnessCardStore } from '../fitness/store.js';
import { FITNESS_HARNESS_VERSION, type FitnessCard } from '../fitness/types.js';
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
  /** Fitness cards for the (model, role) guard (FR-G6) — required so the guard is structural (see file header). Pass an empty `new FitnessCardStore()` where no bench data exists yet; an unbenched pair passes through without warning (guardFitAssignment's own contract). */
  readonly fitnessStore: FitnessCardStore;
  readonly harnessVersion?: string;
  /** Explicit override to proceed past a non-'fit' verdict (FR-G6). */
  readonly fitnessAck?: boolean;
  readonly fitnessSink?: FitnessEventSink;
}

export interface RouteResult extends ResolvedRoute {
  readonly overrideEvent?: MakerVerifierOverrideEvent;
  readonly fitnessCard?: FitnessCard;
  readonly fitnessAckEvent?: FitnessAckEvent;
}

/** Resolves a (role, taskType) call to a model chain, enforcing the maker != verifier default (FR-G2) and the fitness guard (FR-G6). */
export async function route(request: RouteRequest): Promise<RouteResult> {
  const resolved = resolveModelChain(request.matrix, request.role, request.taskType);

  let overrideEvent: MakerVerifierOverrideEvent | undefined;
  if (isVerifierRole(request.role)) {
    const makerRole = request.makerRole ?? ROLE_CODING_AGENT;
    const makerResolved = resolveModelChain(request.matrix, makerRole, request.taskType);
    overrideEvent = await guardMakerVerifierDistinct({
      verifierRole: request.role,
      makerRole,
      taskType: request.taskType,
      verifierModel: resolved.chain[0]!,
      makerModel: makerResolved.chain[0]!,
      overrideSettings: request.overrideSettings,
      actorId: request.actorId,
      sink: request.sink,
    });
  }

  const fitnessResult: GuardFitAssignmentResult = await guardFitAssignment({
    model: resolved.chain[0]!,
    role: request.role,
    store: request.fitnessStore,
    harnessVersion: request.harnessVersion ?? FITNESS_HARNESS_VERSION,
    ack: request.fitnessAck,
    actorId: request.actorId,
    sink: request.fitnessSink,
  });

  return {
    ...resolved,
    overrideEvent,
    fitnessCard: fitnessResult.card,
    fitnessAckEvent: fitnessResult.ackEvent,
  };
}
