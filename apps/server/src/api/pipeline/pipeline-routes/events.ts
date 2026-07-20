/**
 * `port.emit` implementation: appends the phase event AND mints its
 * anchoring `gate` receipt in one transaction (acceptance criterion 2a — no
 * phase output becomes durable without a receipt). Both `appendEvent` and
 * `mintReceipt` are synchronous (better-sqlite3), matching `PipelinePort`'s
 * synchronous `emit` signature; nesting `mintReceipt`'s own internal
 * transaction inside this one is the same pattern `plans-store.ts`'s
 * `evaluatePlan` already relies on (`insertRow` + `appendEvent` inside
 * `withPlanWriter`'s outer transaction).
 */
import { randomUUID } from 'node:crypto';
import { appendEvent, mintReceipt, type EventLog } from '@shipwright/events';
import type { PipelineRunEvent } from '@shipwright/pipeline';
import { OPERATOR_ACTOR_ID } from '../../server/board-actor.js';

/** Build (phase 4) is decompose's own deliverable — matches `run-pipeline.ts`'s `BUILD_PHASE_ID`. */
export const BUILD_PHASE_ID = 4;

/** Nominal phase index each `PipelineRunEvent` kind lands on (BLUEPRINT §3.2 topology). */
export function phaseForEvent(kind: PipelineRunEvent['kind']): number {
  switch (kind) {
    case 'interview-complete':
      return 2;
    case 'blueprint-synthesized':
      return 2;
    case 'decisions-decided':
      return 3;
    case 'decomposed':
      return BUILD_PHASE_ID;
  }
}

export interface EmitContext {
  readonly runId: string;
  readonly projectId: string;
  readonly signingKey: string;
  readonly now: () => string;
}

export function emitPhaseEvent(
  log: EventLog,
  ctx: EmitContext,
  event: PipelineRunEvent,
): void {
  const receiptId = randomUUID();
  log.db.transaction((): void => {
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
    mintReceipt(
      log,
      {
        id: receiptId,
        kind: 'gate',
        projectId: ctx.projectId,
        phase: phaseForEvent(event.kind),
        validators: [{ name: 'pipeline-phase-output', exitCode: 0, gapCount: 0 }],
        inputFiles: [
          {
            path: `pipeline/${ctx.runId}/${event.kind}.json`,
            content: JSON.stringify(event),
          },
        ],
        actorId: OPERATOR_ACTOR_ID,
        payload: { runId: ctx.runId, event },
      },
      { signingKey: ctx.signingKey, now: ctx.now },
    );
  })();
}
