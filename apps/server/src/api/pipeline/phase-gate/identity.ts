/**
 * Verifier identity for phase-gate receipts (W9-06, Law 5 "maker != verifier is
 * mechanical" — CLAUDE.md law #5, BLUEPRINT §3.2/§3.3).
 *
 * The guard below is unconditional — no per-role override path, same discipline as
 * `packages/pipeline/src/challenger/model-guard.ts`'s `assertChallengerModelDistinct`
 * (a veracity gate has no legitimate reason to let the maker grade its own output) and
 * deliberately NOT `packages/gateway/src/routing/maker-verifier.ts`'s
 * `guardMakerVerifierDistinct`, which exists for model *routing* preference and allows
 * an explicit settings override — wrong shape for a trust-boundary mint.
 *
 * Mechanical, not conventional (the brief's own distinction): this is not "the caller
 * is expected to pass two different strings" — `authorActorId` is a REQUIRED,
 * non-blank input, and the equality check runs unconditionally before any validator
 * executes, so a same-identity call can never even produce a run, let alone a receipt.
 * A red fixture (`identity.test.ts`) proves the refusal.
 */
import { createIdentity, getIdentity, type EventLog } from '@dokima/events';

/** The phase-gate runner's own identity — distinct by construction from any
 * content-authoring role (`specialist:<role>`, human operator, etc). Created lazily
 * via `ensurePhaseGateVerifierIdentity` the first time it mints, mirroring
 * `apps/server/src/api/server/board-actor.ts`'s `ensureOperatorIdentity` pattern
 * (events.actor_id is FK-enforced against identities.id). */
export const PHASE_GATE_VERIFIER_ACTOR_ID = 'phase-gate-runner';

export function ensurePhaseGateVerifierIdentity(
  log: EventLog,
  actorId: string = PHASE_GATE_VERIFIER_ACTOR_ID,
  now?: () => string,
): void {
  if (getIdentity(log, actorId)) return;
  createIdentity(
    log,
    { id: actorId, name: 'Phase Gate Runner', kind: 'machine' },
    { now },
  );
}

export class PhaseGateMissingAuthorIdentityError extends Error {
  constructor() {
    super(
      'authorActorId is required and must be non-blank — the phase gate must know which ' +
        'identity authored the currently-on-disk phase output to check it against the ' +
        'verifier (Law 5); an omitted/blank value would make the maker != verifier guard ' +
        'vacuous, not merely unchecked',
    );
    this.name = 'PhaseGateMissingAuthorIdentityError';
  }
}

export class PhaseGateSameIdentityError extends Error {
  constructor(
    public readonly phaseId: number,
    public readonly identity: string,
  ) {
    super(
      `refusing to mint a phase ${phaseId} gate receipt — verifier identity "${identity}" ` +
        'is the same identity that authored the phase output (Law 5, maker != verifier; ' +
        'the phase gate has no override path, unlike model-routing preference guards)',
    );
    this.name = 'PhaseGateSameIdentityError';
  }
}

/**
 * Throws when `authorActorId` is missing/blank, or equals `verifierActorId` (compared
 * trimmed, so whitespace padding can't defeat the check). Called unconditionally BEFORE
 * `runPhaseGate` loads or runs a single validator.
 */
export function assertVerifierDistinctFromAuthor(
  phaseId: number,
  authorActorId: string,
  verifierActorId: string,
): void {
  const author = authorActorId.trim();
  if (author === '') {
    throw new PhaseGateMissingAuthorIdentityError();
  }
  if (author === verifierActorId.trim()) {
    throw new PhaseGateSameIdentityError(phaseId, verifierActorId);
  }
}
