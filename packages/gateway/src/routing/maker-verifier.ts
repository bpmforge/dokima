/**
 * Maker != verifier default (FR-G2): reviewer/challenger roles refuse to
 * resolve to the same model the maker used, unless an explicit per-role
 * override setting is on — and using that override always mints an event
 * (mirrors packages/shared/src/config/events.ts's injectable-sink pattern
 * for settings.changed, since this package cannot depend on
 * packages/shared or packages/events from this ticket's write_scope).
 */

import { resolveScopedValue } from './matrix.js';
import {
  VERIFIER_ROLES,
  type AgentRole,
  type RoutingScope,
  type ScopedOverrideSettings,
  type TaskType,
} from './types.js';

export function isVerifierRole(role: AgentRole): boolean {
  return VERIFIER_ROLES.includes(role);
}

/** Thrown when a verifier role would resolve to the same model as the maker, with no override permitting it. */
export class SameModelRefusedError extends Error {
  constructor(
    public readonly verifierRole: AgentRole,
    public readonly makerRole: AgentRole,
    public readonly model: string,
  ) {
    super(
      `refusing to route '${verifierRole}' to '${model}' — same model as maker role '${makerRole}'; set an explicit override to allow it`,
    );
    this.name = 'SameModelRefusedError';
  }
}

export interface MakerVerifierOverrideEvent {
  readonly type: 'routing.maker_verifier_override';
  readonly verifierRole: AgentRole;
  readonly makerRole: AgentRole;
  readonly taskType: TaskType;
  readonly model: string;
  readonly scope: RoutingScope;
  readonly actorId: string;
  readonly occurredAt: string;
}

export interface RoutingEventSink {
  emit(event: MakerVerifierOverrideEvent): void | Promise<void>;
}

export const noopRoutingEventSink: RoutingEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt out
    // explicitly by omitting a sink; production call sites must pass a real one
    // wired to packages/events.
  },
};

export function createInMemoryRoutingEventSink(): RoutingEventSink & {
  events: MakerVerifierOverrideEvent[];
} {
  const events: MakerVerifierOverrideEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}

export interface MakerVerifierGuardInput {
  readonly verifierRole: AgentRole;
  readonly makerRole: AgentRole;
  readonly taskType: TaskType;
  /** The verifier's resolved primary model (candidate to check). */
  readonly verifierModel: string;
  /** The maker's resolved primary model for the same task type. */
  readonly makerModel: string;
  readonly overrideSettings?: ScopedOverrideSettings;
  readonly actorId: string;
  readonly sink?: RoutingEventSink;
}

/**
 * Guards against maker==verifier. Only applies when verifierRole is a known
 * verifier role (reviewer/challenger) — other roles are never checked.
 * Returns the override event when an explicit override was used (and emits
 * it via `sink`), or undefined when no collision occurred.
 */
export async function guardMakerVerifierDistinct(
  input: MakerVerifierGuardInput,
): Promise<MakerVerifierOverrideEvent | undefined> {
  if (!isVerifierRole(input.verifierRole)) return undefined;
  if (input.verifierModel !== input.makerModel) return undefined;

  const override = resolveScopedValue(input.overrideSettings ?? {}, input.verifierRole);
  if (!override || override.value !== true) {
    throw new SameModelRefusedError(
      input.verifierRole,
      input.makerRole,
      input.verifierModel,
    );
  }

  const event: MakerVerifierOverrideEvent = {
    type: 'routing.maker_verifier_override',
    verifierRole: input.verifierRole,
    makerRole: input.makerRole,
    taskType: input.taskType,
    model: input.verifierModel,
    scope: override.scope,
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
  };
  await input.sink?.emit(event);
  return event;
}
