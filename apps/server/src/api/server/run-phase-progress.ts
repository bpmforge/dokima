/**
 * W19-01 — the phase gate on the happy path.
 *
 * Until this chapter, `runPhaseGate` (W9-06) and `decideAdvance` (W9-07) were
 * complete, receipt-honest — and reachable only by hand-POSTing two routes.
 * The real flow (a build run finishing) never ran a gate, so a project's
 * phase stayed `null` forever and no receipt was ever minted on the path a
 * founder actually walks.
 *
 * `attemptPhaseProgress` runs after a build run finishes cleanly:
 *
 *   1. derive the current phase from the ledger (latest `phase.advanced`
 *      event's `to`; a project with none is in phase 0);
 *   2. run the REAL gate — `runPhaseGate` with the distinct verifier
 *      identity (Law 5), the real validator pack, the real deliverable tree;
 *   3. if it mints, hand the receipt to `decideAdvance` (the same verify
 *      primitive the route binds) and, if allowed, append `phase.advanced`
 *      with the receipt id — the ONLY writer of durable phase state;
 *   4. either way, say what happened in the review queue: a pass lands as
 *      `gate_passed`, a refusal as `blocked` with the gate's own reasons.
 *
 * A refusal never fails the build run — most projects genuinely have not
 * written phase 0's deliverables yet, and the honest answer is a named
 * refusal in the morning queue, not a crashed run (FR-G5). Errors out of
 * this whole attempt are contained by the caller for the same reason.
 */
import {
  appendEvent,
  listEvents,
  verifyReceipt,
  type EventLog,
  type ReceiptInputFile,
} from '@dokima/events';
import { decideAdvance, getPhase, isLastPhase, type PhaseId } from '@dokima/pipeline';
import {
  PhaseDeliverableMissingError,
  readPhaseInputFiles,
} from '../pipeline/phase-gate/input-files.js';
import {
  ensurePhaseGateVerifierIdentity,
  PHASE_GATE_VERIFIER_ACTOR_ID,
} from '../pipeline/phase-gate/identity.js';
import { runPhaseGate } from '../pipeline/phase-gate/runner.js';
import { emitReviewItem } from '../notifications/emit.js';

export const PHASE_ADVANCED_EVENT = 'phase.advanced';

/** Latest ledgered phase, as a projection off the log (C-6: disposable). */
export function currentPhaseFromLog(log: EventLog): PhaseId {
  let phase: PhaseId = 0;
  for (const event of listEvents(log)) {
    if (event.eventType !== PHASE_ADVANCED_EVENT) continue;
    const payload = event.payload as { to?: unknown } | null;
    if (typeof payload?.to === 'number') phase = payload.to as PhaseId;
  }
  return phase;
}

export interface AttemptPhaseProgressArgs {
  readonly log: EventLog;
  readonly projectId: string;
  readonly projectRoot: string;
  /** Who authored the phase's on-disk output — the build run's actor. */
  readonly authorActorId: string;
  /** Directory validator executables live in — `content/validators` in production. */
  readonly contentDir: string;
  readonly signingKey: string;
  readonly runId: string;
  readonly now: () => string;
}

export interface PhaseProgressOutcome {
  readonly phaseId: PhaseId;
  readonly advancedTo: PhaseId | null;
  readonly reasons: readonly string[];
}

export async function attemptPhaseProgress(
  args: AttemptPhaseProgressArgs,
): Promise<PhaseProgressOutcome> {
  const { log, now } = args;
  const phaseId = currentPhaseFromLog(log);
  if (isLastPhase(phaseId)) {
    return { phaseId, advancedTo: null, reasons: ['already at the last phase'] };
  }
  const phase = getPhase(phaseId);
  // The verifier identity must exist before anything is ledgered under it —
  // a refusal can emit a review item before the runner ever mints.
  ensurePhaseGateVerifierIdentity(log, PHASE_GATE_VERIFIER_ACTOR_ID, now);

  const gate = await runPhaseGate(
    log,
    {
      projectId: args.projectId,
      phaseId,
      contentDir: args.contentDir,
      projectRoot: args.projectRoot,
      authorActorId: args.authorActorId,
      now,
    },
    { signingKey: args.signingKey },
  );

  if (!gate.ok || !gate.receipt) {
    emitReviewItem(
      log,
      {
        kind: 'blocked',
        refType: 'run',
        refId: args.runId,
        title: `Phase gate: ${phase.name} did not clear`,
        summary:
          `The ${phase.name} phase (${phaseId}) gate refused after this run — ` +
          `the project stays in ${phase.name}. ` +
          firstReasons(gate.reasons),
      },
      {
        id: `phase-gate-${args.runId}-${phaseId}`,
        actorId: PHASE_GATE_VERIFIER_ACTOR_ID,
        now,
      },
    );
    return { phaseId, advancedTo: null, reasons: gate.reasons };
  }

  // Same fresh-off-disk verification the manual advance route performs: the
  // receipt is only as good as the tree it hashed still being the tree on disk.
  let inputFiles: readonly ReceiptInputFile[];
  try {
    inputFiles = await readPhaseInputFiles(phase, args.projectRoot);
  } catch (err) {
    if (err instanceof PhaseDeliverableMissingError) {
      return { phaseId, advancedTo: null, reasons: [err.message] };
    }
    throw err;
  }

  const decision = decideAdvance(
    { fromPhaseId: phaseId, gateReceiptId: gate.receipt.id, waiverReceiptId: null },
    {
      verifyReceipt: (receiptId, requiredValidators) =>
        verifyReceipt(log, receiptId, {
          signingKey: args.signingKey,
          inputFiles,
          requiredValidators,
        }),
    },
  );
  if (!decision.allowed) {
    return { phaseId, advancedTo: null, reasons: decision.reasons };
  }

  const toPhaseId = decision.toPhaseId as PhaseId;
  appendEvent(
    log,
    {
      eventType: PHASE_ADVANCED_EVENT,
      actorId: PHASE_GATE_VERIFIER_ACTOR_ID,
      runId: args.runId,
      payload: { from: phaseId, to: toPhaseId, gate_receipt_id: gate.receipt.id },
    },
    { now },
  );
  emitReviewItem(
    log,
    {
      kind: 'gate_passed',
      refType: 'run',
      refId: args.runId,
      title: `Phase advanced: ${phase.name} → ${getPhase(toPhaseId).name}`,
      summary:
        `Every ${phase.name} validator passed and the receipt (${gate.receipt.id}) ` +
        `verified against the tree on disk. The project is now in ${getPhase(toPhaseId).name}.`,
    },
    {
      id: `phase-advance-${args.runId}-${phaseId}`,
      actorId: PHASE_GATE_VERIFIER_ACTOR_ID,
      now,
    },
  );
  return { phaseId, advancedTo: toPhaseId, reasons: [] };
}

function firstReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) return '';
  const head = reasons.slice(0, 2).join('; ');
  const more = reasons.length > 2 ? ` (+${reasons.length - 2} more)` : '';
  return `Reasons: ${head}${more}`;
}
