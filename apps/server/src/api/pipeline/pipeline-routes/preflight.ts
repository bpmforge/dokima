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
  assertDecisionComplete,
  buildTechnicalSlate,
  collectDrafts,
  synthesizeBlueprint,
  type SynthesizeBlueprintInput,
  type SynthesizedBlueprint,
  type TechnicalSlate,
  type TechnicalSlateInput,
  type TicketDraftInput,
} from '@shipwright/pipeline';
import type { RealGatewayPort } from '../gateway-model-port.js';
import { BUILD_PHASE_ID } from './events.js';
import type { RunPipelineRequestBody } from './request-body.js';

export interface PreflightResult {
  readonly blueprintInput: SynthesizeBlueprintInput;
  readonly blueprint: SynthesizedBlueprint;
  readonly technicalSlateInput: TechnicalSlateInput;
  readonly technicalSlate: TechnicalSlate;
  readonly ticketDrafts: readonly TicketDraftInput[];
}

export async function runPreflight(
  modelPort: RealGatewayPort,
  body: RunPipelineRequestBody,
  ledgerMarkdown: string,
): Promise<PreflightResult> {
  const drafts = collectDrafts(body.interviewSession);
  const blueprintInput = await modelPort.resolveBlueprintInput(
    drafts,
    body.blueprintTitle,
  );
  const blueprint = synthesizeBlueprint(blueprintInput);
  assertDecisionComplete(blueprint.document.markdown, ledgerMarkdown, BUILD_PHASE_ID);

  const technicalSlateInput = await modelPort.resolveTechnicalSlateInput(blueprint);
  const technicalSlate = buildTechnicalSlate(technicalSlateInput);

  const ticketDrafts = await modelPort.resolveTicketDrafts(blueprint, technicalSlate);

  return { blueprintInput, blueprint, technicalSlateInput, technicalSlate, ticketDrafts };
}
