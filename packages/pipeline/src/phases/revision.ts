/**
 * FR-C8 (R-H2): "feedback on a gated deliverable emits `revision.requested`
 * → a revision HANDOFF to the producing role → the revised version renders
 * as a diff against the commented version." Per AC2, filing the request also
 * invalidates downstream receipts per FR-P3 — not lazily, on the next hash
 * check, but immediately: a revision has been *requested*, so every phase
 * from the commented deliverable's phase onward is no longer trustworthy as
 * a completed prerequisite until the producing role responds, independent of
 * whether the file on disk has changed yet.
 *
 * `revision.requested`'s real home is `@dokima/events`' `appendEvent`;
 * the real HANDOFF render is `@dokima/loop`'s `renderHandoff` — both out
 * of reach from this write_scope (types.ts header). This module returns the
 * plain descriptors (`RevisionRequestedEvent`, `RevisionHandoff`) the wiring
 * ticket feeds into those two functions unchanged.
 */
import { PHASES } from './topology.js';
import type {
  Deliverable,
  PhaseId,
  PhaseStalenessResult,
  RevisionHandoff,
  RevisionRequestedEvent,
} from './types.js';

export class UnknownDeliverableError extends Error {
  constructor(artifactPath: string, phaseId: PhaseId) {
    super(`"${artifactPath}" is not a declared deliverable of phase ${phaseId}`);
    this.name = 'UnknownDeliverableError';
  }
}

export interface RequestRevisionInput {
  readonly artifactPath: string;
  readonly phaseId: PhaseId;
  readonly comment: string;
  /** Identity filing the feedback (the human/reviewer, not the producing role). */
  readonly requestedBy: string;
}

export interface RevisionOutcome {
  readonly event: RevisionRequestedEvent;
  readonly handoff: RevisionHandoff;
  /** Every phase from `phaseId` onward, all flagged stale (FR-P3). */
  readonly invalidated: readonly PhaseStalenessResult[];
}

function findDeliverable(phaseId: PhaseId, artifactPath: string): Deliverable {
  const phase = PHASES.find((p) => p.id === phaseId);
  const deliverable = phase?.deliverables.find((d) => d.id === artifactPath);
  if (!deliverable) throw new UnknownDeliverableError(artifactPath, phaseId);
  return deliverable;
}

function buildHandoff(
  input: RequestRevisionInput,
  producingRole: string,
): RevisionHandoff {
  return {
    role: producingRole,
    mission: `Revise ${input.artifactPath} per reviewer feedback`,
    ticket: {
      id: `revision-${input.phaseId}-${input.artifactPath}`,
      title: `Revise ${input.artifactPath}`,
    },
    context: input.comment,
    writeScope: [input.artifactPath],
    produce: [`an updated ${input.artifactPath} resolving the comment by reference`],
    verify: `phase-${input.phaseId} validator set`,
  };
}

/**
 * Feedback on a gated deliverable → `revision.requested` + revision HANDOFF
 * to the producing role + immediate downstream invalidation. Refuses (throws
 * `UnknownDeliverableError`) for an artifact path that isn't a declared
 * deliverable of `phaseId` — feedback must name a real gated deliverable,
 * never an arbitrary path (FR-C8 is scoped to "any deliverable in the
 * artifact viewer", not free-text file feedback).
 */
export function requestRevision(input: RequestRevisionInput): RevisionOutcome {
  const deliverable = findDeliverable(input.phaseId, input.artifactPath);

  const event: RevisionRequestedEvent = {
    eventType: 'revision.requested',
    actorId: input.requestedBy,
    payload: {
      artifactPath: input.artifactPath,
      phaseId: input.phaseId,
      comment: input.comment,
      producingRole: deliverable.producingRole,
    },
  };

  const handoff = buildHandoff(input, deliverable.producingRole);

  const invalidated: PhaseStalenessResult[] = PHASES.filter(
    (p) => p.id >= input.phaseId,
  ).map((p) => ({
    phaseId: p.id,
    stale: true,
    reasons: [
      `revision requested on "${input.artifactPath}" (phase ${input.phaseId}) — pending ` +
        `${deliverable.producingRole}'s response, not yet re-verifiable (FR-C8/FR-P3)`,
    ],
  }));

  return { event, handoff, invalidated };
}
