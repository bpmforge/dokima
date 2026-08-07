/**
 * `port.emit` implementation: appends one plain, hash-chained AUDIT event
 * per pipeline phase (BLUEPRINT §3.2's `PipelineRunEvent` trail).
 *
 * SECURITY_W5 CRITICAL FIX (Law 4/5): this used to also mint a `gate`
 * receipt for every phase, with a hardcoded pass
 * (`[{name: 'pipeline-phase-output', exitCode: 0, gapCount: 0}]`) signed by
 * `OPERATOR_ACTOR_ID` — the same identity that produced the model-authored
 * content being "attested". No independent validator ever ran on that
 * output, so the receipt was a component self-attesting its own content as
 * a passing gate (violates "never let a component verify its own output")
 * and collapsed maker/verifier into one identity (violates the mechanical
 * maker≠verifier requirement). It is gone: this function only ever appends
 * a plain audit event, never a receipt. Genuine gates (decision-complete,
 * close) mint real receipts elsewhere, from real checks, by a distinct
 * verifier identity — untouched by this fix.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { PipelineRunEvent } from '@dokima/pipeline';
import { OPERATOR_ACTOR_ID } from '../../server/board-actor.js';

/** Build (phase 4) is decompose's own deliverable — matches `run-pipeline.ts`'s `BUILD_PHASE_ID`. */
export const BUILD_PHASE_ID = 4;

export interface EmitContext {
  readonly runId: string;
  readonly now: () => string;
}

/**
 * W10-58: one audit event per completed model-authored STAGE, appended while
 * the run is still in flight.
 *
 * Distinct from `emitPhaseEvent` on purpose. That one reports `runPipeline`'s
 * internal phases, all of which happen in a single fast, synchronous burst
 * AFTER every gateway call has already been paid for — so it emits three events
 * in milliseconds, minutes after the founder started waiting. These are the
 * three gateway calls themselves, which are the entire wait, and until now
 * nothing observable happened during them at all.
 *
 * Same self-attestation rule as its neighbour: a plain hash-chained audit
 * event, never a `gate` receipt. Nothing has verified this output — it is a
 * progress marker, and minting a passing receipt for it would be exactly the
 * Law 4/5 violation the SECURITY_W5 fix above removed.
 */
export function emitStageEvent(log: EventLog, ctx: EmitContext, stage: string): void {
  appendEvent(
    log,
    {
      eventType: 'pipeline.stage.completed',
      actorId: OPERATOR_ACTOR_ID,
      runId: ctx.runId,
      payload: { stage, at: ctx.now() },
    },
    { now: ctx.now },
  );
}

export function emitPhaseEvent(
  log: EventLog,
  ctx: EmitContext,
  event: PipelineRunEvent,
): void {
  appendEvent(
    log,
    {
      eventType: `pipeline.${event.kind}`,
      actorId: OPERATOR_ACTOR_ID,
      runId: ctx.runId,
      payload: event,
    },
    { now: ctx.now },
  );
}
