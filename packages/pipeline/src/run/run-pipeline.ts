/**
 * The pipeline orchestrator (BLUEPRINT §4, phases 0–4): chains the four
 * built-but-never-called engine modules end to end — a completed interview
 * session -> `synthesizeBlueprint` -> `buildTechnicalSlate` (the decisions
 * phase) -> `decompose` — threading each phase's real output into the
 * next's input via `PipelineModelPort` (types.ts). `runPipeline` itself
 * stays pure and deterministic: it never authors prose and never imports a
 * model/provider client directly (CLAUDE.md law #6) — every seam that needs
 * real content goes through the injected port.
 *
 * The decision-complete gate (FR-P7) falls out of the phase modules for
 * free rather than needing its own resolution engine here: a blueprint
 * synthesized with `openQuestions: []` renders "None — decision-complete"
 * with zero markers and passes `assertDecisionComplete` trivially; one with
 * any open question always carries an UNRESOLVED marker fresh out of
 * `synthesizeBlueprint` (`synth.ts` only ever emits the unresolved line),
 * so it fails the gate immediately. Actually resolving a founder-decision
 * marker (minting a D-ID, appending the ledger) is the real ledger-
 * persistence work `W5-13`/`W5-18` own outside this package's reach — this
 * orchestrator only enforces that decompose() never runs against a
 * blueprint the gate hasn't cleared.
 *
 * On any phase's typed error (an incomplete interview session, a malformed
 * blueprint/slate from `model`, or the decision gate refusing) this throws
 * and returns nothing — no partial `DecomposedPlan` is ever constructed,
 * and no phase-complete event is emitted for a phase that didn't actually
 * complete.
 */
import { assertDecisionComplete } from '../blueprint/gate.js';
import { synthesizeBlueprint } from '../blueprint/synth.js';
import { buildTechnicalSlate } from '../decisions/technical-slate.js';
import { decompose } from '../decompose/decompose.js';
import { deriveRequirementIds } from '../assembler/ledger.js';
import type { DecomposedPlan } from '../decompose/types.js';
import { collectDrafts, isInterviewComplete } from '../interview/session.js';
import { deliverableDrafts } from './deliverable-drafts.js';
import type { PipelinePort, RunPipelineInput } from './types.js';

/** The Locked-phase (3/4, FR-P7) this run's decompose step gates on. Build
 * (phase 4) is decompose's own deliverable — `ticket-board`, `../phases/
 * topology.ts`'s `PHASES[4]` — so that is the phase this orchestrator
 * checks against. */
const BUILD_PHASE_ID = 4;

export class IncompleteInterviewSessionError extends Error {
  constructor() {
    super(
      'runPipeline requires a complete interview session — every topic must be ' +
        '"drafted" or "skipped" (isInterviewComplete) before the pipeline can run',
    );
    this.name = 'IncompleteInterviewSessionError';
  }
}

/**
 * Runs interview -> blueprint -> decisions -> decompose in sequence,
 * emitting one `PipelineRunEvent` per completed phase via `port.emit`, and
 * returns the resulting `DecomposedPlan`. Throws (never returns a partial
 * plan) if the interview session isn't complete, if any phase module
 * rejects its input, or if the blueprint's decision-complete gate
 * (FR-P7) refuses phase 4.
 */

export function runPipeline(input: RunPipelineInput, port: PipelinePort): DecomposedPlan {
  if (!isInterviewComplete(input.interviewSession)) {
    throw new IncompleteInterviewSessionError();
  }
  const drafts = collectDrafts(input.interviewSession);
  port.emit({ kind: 'interview-complete', topicCount: drafts.length });

  const blueprintInput = port.model.blueprintInputFrom(drafts, input.blueprintTitle);
  const blueprint = synthesizeBlueprint(blueprintInput);
  port.emit({
    kind: 'blueprint-synthesized',
    version: blueprint.document.version,
    // W22-26: the document itself, not just its version. Everything downstream
    // of here — the maker writing docs/VISION.md most of all — needs to know
    // what product this is, and this emit is the only moment it is available.
    markdown: blueprint.document.markdown,
  });

  assertDecisionComplete(
    blueprint.document.markdown,
    input.ledgerMarkdown,
    BUILD_PHASE_ID,
  );

  const technicalSlateInput = port.model.technicalSlateInputFrom(blueprint);
  const technicalSlate = buildTechnicalSlate(technicalSlateInput);
  port.emit({ kind: 'decisions-decided', slateTitle: technicalSlate.title });

  const ticketDrafts = [
    // W21-76: FIRST, so the documents a phase gate checks for are the first
    // thing the board asks for rather than an afterthought below the features.
    // W23-37: with the blueprint, so each verify can refuse boilerplate.
    ...deliverableDrafts(input.existingDeliverables ?? [], blueprint.document.markdown),
    ...port.model.ticketDraftsFrom(blueprint, technicalSlate),
  ];
  // W21-97: a plan built from someone's IDEA carries its quality work. This is
  // the call site that serves a person who may have no development experience
  // and would never think to ask for a security review — unlike
  // `buildFixBacklog`, whose input is already findings.
  // P6-04: the feature map is not optional here. This is the product's own
  // planning path, and a plan whose tickets carry no connection to the
  // stories they serve is exactly the "bunch of tickets, no product shape"
  // defect P6-01 built the map to prevent — built and unwired is our house
  // failure mode (Law L4), so the denominator is passed at the ONLY call
  // site that serves an end user's idea. Seams do not exist yet at
  // blueprint time; the map records story-connections and F-unmapped now,
  // and the seam edges join it when seams are declared.
  const plan = decompose(ticketDrafts, {
    includeQualityWork: true,
    requirementIds: deriveRequirementIds(blueprint.document.markdown),
  });
  port.emit({ kind: 'decomposed', ticketCount: plan.tickets.length });

  return plan;
}
