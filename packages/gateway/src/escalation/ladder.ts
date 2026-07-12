/**
 * The escalation ladder driver (BLUEPRINT §3.3, FR-G3):
 *
 *   R0  Memory/playbook answer (free)      — MemoryConsultHook, resolves for free
 *   R1  Cheapest capable model, micro-loop — matrix's primary model for (role, taskType)
 *   R2  Same ticket, one rung up           — matrix's first fallback model, automatic on R1 gate failure
 *   R3  Frontier model, single re-run      — matrix's model for taskType 'escalation' (BLUEPRINT §3.3's
 *                                             task-type axis; PRESET_ALL_CLOUD wires `default.taskTypes.escalation`)
 *   R4  Blocked-with-evidence              — ticket parked; human decides
 *
 * Escalation is per-ticket and evidence-triggered only (never vibes-triggered):
 * the ladder advances a rung ONLY on a failed gate outcome, and the advance
 * event carries that failure's receipts verbatim. A rung whose attempt
 * passes ends the ladder immediately with zero further events — a ticket
 * that never fails a gate can never produce an escalation event.
 *
 * The actual model call + micro-loop (R1's "up to N revise passes with gap
 * feedback") lives in packages/loop, which this package cannot depend on
 * (no workspace dependency declared from this ticket's write_scope, same
 * constraint W2-05 documented for packages/shared). `AttemptRunner` is the
 * injection point: the caller supplies a function that runs the rung's
 * model chain (micro-loop included) and reports back one GateOutcome. This
 * ticket owns the ladder's rung sequencing, model selection, and event
 * emission — not the model call itself.
 */

import { resolveModelChain } from '../routing/matrix.js';
import {
  ROLE_CODING_AGENT,
  type AgentRole,
  type ScopedRoleMatrix,
  type TaskType,
} from '../routing/types.js';
import {
  noopEscalationEventSink,
  type EscalationEvent,
  type EscalationEventSink,
} from './events.js';
import { noopMemoryConsultHook, type MemoryConsultHook } from './memory-hook.js';
import { RUNG_ORDER, type FailureReceipt, type GateOutcome, type Rung } from './types.js';

/**
 * Thrown when an attempt reports failure without receipts. Mechanically
 * enforces "evidence-triggered, never vibes-triggered" (BLUEPRINT §3.3):
 * an AttemptRunner cannot cause a rung advance — or an R4 block — without
 * evidence to attach to it.
 */
export class MissingFailureEvidenceError extends Error {
  constructor(public readonly rung: Rung) {
    super(
      `escalation ladder refuses to advance past ${rung} without failure receipts — ` +
        'the ladder is evidence-triggered only (FR-G3)',
    );
    this.name = 'MissingFailureEvidenceError';
  }
}

export interface RungAttemptContext {
  readonly rung: Rung;
  readonly ticketId: string;
  readonly role: AgentRole;
  readonly taskType: TaskType;
  /** Single-element for R1-R3: the one model this rung attempts against. */
  readonly modelChain: readonly string[];
}

export type AttemptRunner = (
  context: RungAttemptContext,
) => GateOutcome | Promise<GateOutcome>;

export type RungAttemptStatus = 'memory_hit' | 'no_memory_hit' | 'passed' | 'failed';

export interface RungAttemptRecord {
  readonly rung: Rung;
  readonly model?: string;
  readonly status: RungAttemptStatus;
  readonly receipts: readonly FailureReceipt[];
}

export type EscalationLadderStatus = 'resolved' | 'blocked';

export interface EscalationLadderOutcome {
  readonly ticketId: string;
  readonly status: EscalationLadderStatus;
  readonly finalRung: Rung;
  readonly resolvedBy?: 'memory' | 'model';
  readonly model?: string;
  /** One record per rung actually attempted, in RUNG_ORDER (R0 always present). */
  readonly attempts: readonly RungAttemptRecord[];
  /** One event per rung advance actually emitted — empty when the ticket resolves without ever failing a gate. */
  readonly events: readonly EscalationEvent[];
}

export interface EscalationLadderInput {
  readonly ticketId: string;
  /** The ONE checkable success criterion this ladder run is trying to satisfy (fed to the R0 memory hook). */
  readonly criterion: string;
  readonly actorId: string;
  readonly matrix: ScopedRoleMatrix;
  /** Default 'coding-agent' — the maker role whose model chain the ladder climbs. */
  readonly role?: AgentRole;
  /** Default 'code'. */
  readonly taskType?: TaskType;
  readonly runAttempt: AttemptRunner;
  readonly memoryHook?: MemoryConsultHook;
  readonly sink?: EscalationEventSink;
  readonly now?: () => string;
}

function assertEvidence(rung: Rung, outcome: GateOutcome): void {
  if (!outcome.passed && outcome.receipts.length === 0) {
    throw new MissingFailureEvidenceError(rung);
  }
}

/** Resolves R1's and R2's models from the base (role, taskType) chain — R2 is "one rung up" the fallback chain, degenerating to R1's model if the matrix defines no fallback. */
function resolveClimbModels(
  matrix: ScopedRoleMatrix,
  role: AgentRole,
  taskType: TaskType,
): { r1: string; r2: string } {
  const base = resolveModelChain(matrix, role, taskType);
  const r1 = base.chain[0]!;
  const r2 = base.chain[1] ?? r1;
  return { r1, r2 };
}

/** Resolves R3's frontier model via taskType 'escalation' — the matrix's dedicated axis for the expensive rung (BLUEPRINT §3.3). */
function resolveFrontierModel(matrix: ScopedRoleMatrix, role: AgentRole): string {
  return resolveModelChain(matrix, role, 'escalation').chain[0]!;
}

/** Runs the R0-R4 escalation ladder for one ticket (BLUEPRINT §3.3, FR-G3). */
export async function runEscalationLadder(
  input: EscalationLadderInput,
): Promise<EscalationLadderOutcome> {
  const role = input.role ?? ROLE_CODING_AGENT;
  const taskType = input.taskType ?? 'code';
  const now = input.now ?? (() => new Date().toISOString());
  const sink = input.sink ?? noopEscalationEventSink;
  const memoryHook = input.memoryHook ?? noopMemoryConsultHook;

  const attempts: RungAttemptRecord[] = [];
  const events: EscalationEvent[] = [];

  async function emit(
    fromRung: Rung,
    toRung: Rung,
    type: EscalationEvent['type'],
    receipts: readonly FailureReceipt[],
  ): Promise<void> {
    const event: EscalationEvent = {
      type,
      ticketId: input.ticketId,
      fromRung,
      toRung,
      actorId: input.actorId,
      receipts,
      occurredAt: now(),
    };
    events.push(event);
    await sink.emit(event);
  }

  function resolved(rung: Rung, model?: string): EscalationLadderOutcome {
    return {
      ticketId: input.ticketId,
      status: 'resolved',
      finalRung: rung,
      resolvedBy: rung === 'R0' ? 'memory' : 'model',
      model,
      attempts,
      events,
    };
  }

  // R0 — memory/playbook consult hook (free; never itself an escalation).
  const memoryResult = await memoryHook.consult({
    ticketId: input.ticketId,
    criterion: input.criterion,
  });
  if (memoryResult.answered) {
    attempts.push({ rung: 'R0', status: 'memory_hit', receipts: [] });
    return resolved('R0');
  }
  attempts.push({ rung: 'R0', status: 'no_memory_hit', receipts: [] });

  const { r1, r2 } = resolveClimbModels(input.matrix, role, taskType);
  const climbModels: Record<'R1' | 'R2', string> = { R1: r1, R2: r2 };

  let lastFailure: { rung: Rung; receipts: readonly FailureReceipt[] } | undefined;

  for (const rung of ['R1', 'R2'] as const) {
    if (lastFailure) {
      await emit(
        lastFailure.rung,
        rung,
        'escalation.rung_advanced',
        lastFailure.receipts,
      );
    }
    const model = climbModels[rung];
    const outcome = await input.runAttempt({
      rung,
      ticketId: input.ticketId,
      role,
      taskType,
      modelChain: [model],
    });
    if (outcome.passed) {
      attempts.push({ rung, model, status: 'passed', receipts: [] });
      return resolved(rung, model);
    }
    assertEvidence(rung, outcome);
    attempts.push({ rung, model, status: 'failed', receipts: outcome.receipts });
    lastFailure = { rung, receipts: outcome.receipts };
  }

  // R3 — frontier, single re-run, via the 'escalation' task type.
  await emit(lastFailure!.rung, 'R3', 'escalation.rung_advanced', lastFailure!.receipts);
  const r3Model = resolveFrontierModel(input.matrix, role);
  const r3Outcome = await input.runAttempt({
    rung: 'R3',
    ticketId: input.ticketId,
    role,
    taskType,
    modelChain: [r3Model],
  });
  if (r3Outcome.passed) {
    attempts.push({ rung: 'R3', model: r3Model, status: 'passed', receipts: [] });
    return resolved('R3', r3Model);
  }
  assertEvidence('R3', r3Outcome);
  attempts.push({
    rung: 'R3',
    model: r3Model,
    status: 'failed',
    receipts: r3Outcome.receipts,
  });

  // R4 — blocked-with-evidence; ticket parked, human decides.
  await emit('R3', 'R4', 'escalation.blocked', r3Outcome.receipts);

  return {
    ticketId: input.ticketId,
    status: 'blocked',
    finalRung: 'R4',
    attempts,
    events,
  };
}

/** True iff `attempts` visits rungs in RUNG_ORDER with no repeat or skip-back — the monotonicity invariant TESTING.md §3 requires (exposed for tests). */
export function isMonotonicRungSequence(attempts: readonly RungAttemptRecord[]): boolean {
  let lastIndex = -1;
  for (const attempt of attempts) {
    const index = RUNG_ORDER.indexOf(attempt.rung);
    if (index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}
