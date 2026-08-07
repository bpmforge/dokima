/**
 * Resolves the three real, model-authored port outputs via the gateway,
 * replaying the pure phase functions in between (see `index.ts`'s module
 * header) so the decision gate can be checked before any further gateway
 * spend, and before `runPipeline` itself is ever called.
 *
 * `ledgerMarkdown` is a plain parameter here, not read off `body` — the
 * caller (`index.ts`) derives it server-side via `./ledger.js` before
 * calling this function, so there is no code path in this module that ever
 * sees caller-supplied ledger content (Law 4 self-attest fix).
 */
import {
  buildTechnicalSlate,
  collectDrafts,
  decideBlueprintUnlock,
  parseMarkers,
  synthesizeBlueprint,
  UnresolvedFounderDecisionError,
  type SynthesizeBlueprintInput,
  type SynthesizedBlueprint,
  type TechnicalSlate,
  type TechnicalSlateInput,
  type TicketDraftInput,
} from '@dokima/pipeline';
import type { RealGatewayPort } from '../gateway-model-port.js';
import { BUILD_PHASE_ID } from './events.js';
import type { RunPipelineRequestBody } from './request-body.js';

export interface PreflightReady {
  readonly status: 'ready';
  readonly blueprintInput: SynthesizeBlueprintInput;
  readonly blueprint: SynthesizedBlueprint;
  readonly technicalSlateInput: TechnicalSlateInput;
  readonly technicalSlate: TechnicalSlate;
  readonly ticketDrafts: readonly TicketDraftInput[];
}

/**
 * The gate refused, and that refusal is CORRECT (FR-P7). W10-67: it is
 * returned rather than thrown so the caller can keep what the founder needs —
 * `blueprintInput` carries the open questions and their slates, and throwing
 * discarded them along with the model call that produced them.
 */
export interface PreflightAwaitingDecisions {
  readonly status: 'awaiting-decisions';
  readonly blueprintInput: SynthesizeBlueprintInput;
  readonly blueprint: SynthesizedBlueprint;
  readonly reasons: readonly string[];
}

export type PreflightResult = PreflightReady | PreflightAwaitingDecisions;

/**
 * The three model-authored stages, named. W10-58: these are exactly the three
 * gateway calls a run pays for, and they are what a founder is waiting on — so
 * they are also the unit of progress reported and the unit of work persisted.
 */
export type PreflightStage = 'blueprint' | 'technical-slate' | 'ticket-drafts';

export interface PreflightHooks {
  /**
   * Called after each gateway call resolves, BEFORE the pure phase function
   * that consumes it runs. Awaited so a caller that persists the value cannot
   * be raced by the next (minutes-long) call — if the process dies mid-run, the
   * work already paid for is on disk rather than in a pending write.
   */
  readonly onStage?: (stage: PreflightStage, value: unknown) => Promise<void> | void;
}

/**
 * W10-67 swapped `assertDecisionComplete` for `decideBlueprintUnlock`. Both
 * exist in `blueprint/gate.ts` for exactly this reason — its own comment says
 * the throwing form is "for call sites that want a hard stop", and this one
 * does not: an unanswered founder decision is a state to present, not a crash.
 * The check still happens in the same place, before any further gateway spend.
 */
export async function runPreflight(
  modelPort: RealGatewayPort,
  body: RunPipelineRequestBody,
  ledgerMarkdown: string,
  hooks: PreflightHooks = {},
): Promise<PreflightResult> {
  const drafts = collectDrafts(body.interviewSession);
  const blueprintInput = await modelPort.resolveBlueprintInput(
    drafts,
    body.blueprintTitle,
  );
  await hooks.onStage?.('blueprint', blueprintInput);
  const blueprint = synthesizeBlueprint(blueprintInput);

  const gate = decideBlueprintUnlock(
    blueprint.document.markdown,
    ledgerMarkdown,
    BUILD_PHASE_ID,
  );
  if (!gate.allowed) {
    // ONLY an unanswered question is a pause. The gate refuses for three
    // reasons and they are not the same kind of thing:
    //
    //   unresolved  — the founder has a real decision to make. Pause.
    //   malformed   — a marker that failed the strict grammar. A defect.
    //   resolved-but-uncited — a marker claiming a D-id that does not exist in
    //                 the on-disk ledger. That is the PLANTED SELF-ATTEST case
    //                 (Law 4 / C-3): `synth.ts` concatenates model-authored
    //                 section bodies unsanitized, so a compromised completion
    //                 can smuggle one in.
    //
    // Presenting a forged resolution as "awaiting your decision" would invite
    // the founder to answer a question that does not exist, and would soften a
    // security refusal into a workflow state. Both stay a hard stop, exactly as
    // before this ticket — caught by the two red fixtures in index.test.ts.
    const parsed = parseMarkers(blueprint.document.markdown);
    const answerable =
      parsed.malformed.length === 0 && parsed.unresolved.length === gate.reasons.length;
    if (answerable) {
      return {
        status: 'awaiting-decisions',
        blueprintInput,
        blueprint,
        reasons: gate.reasons,
      };
    }
    throw new UnresolvedFounderDecisionError(BUILD_PHASE_ID, gate.reasons);
  }

  const technicalSlateInput = await modelPort.resolveTechnicalSlateInput(blueprint);
  await hooks.onStage?.('technical-slate', technicalSlateInput);
  const technicalSlate = buildTechnicalSlate(technicalSlateInput);

  const ticketDrafts = await modelPort.resolveTicketDrafts(blueprint, technicalSlate);
  await hooks.onStage?.('ticket-drafts', ticketDrafts);

  return {
    status: 'ready',
    blueprintInput,
    blueprint,
    technicalSlateInput,
    technicalSlate,
    ticketDrafts,
  };
}
