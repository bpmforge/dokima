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
import { isPathDeliverable, PHASES } from '../phases/topology.js';
import type { TicketDraftInput } from '../decompose/types.js';
import { buildTechnicalSlate } from '../decisions/technical-slate.js';
import { decompose } from '../decompose/decompose.js';
import type { DecomposedPlan } from '../decompose/types.js';
import { collectDrafts, isInterviewComplete } from '../interview/session.js';
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

/**
 * A ticket per phase deliverable the project does not already have.
 *
 * THE GATE WAS RIGHT AND NOTHING FED IT (W21-76). `runPipeline` synthesizes a
 * blueprint and the interview produces implementation tickets; neither writes
 * `docs/VISION.md`, which is what phase 0 declares. So the gate refused on
 * every run for a stated, correct reason, and the project's Fleet card
 * honestly read "Not started" while real work landed.
 *
 * PERSISTING THE BLUEPRINT WOULD NOT HAVE FIXED IT, which is worth recording
 * because it was the cheaper theory: the blueprint is ONE markdown document
 * with a title and sections, not the named files the gate checks for.
 *
 * A TICKET RATHER THAN A SILENT WRITE: the gate exists so a phase is entered
 * on evidence, and the evidence should be something a ticket was actually
 * asked to produce — visible, orderable work a person can read, reorder or
 * delete. Same argument as W21-97's quality tickets, which this sits beside.
 *
 * EVERY PHASE, NOT JUST IDEA (W22-11). W21-76 emitted phase 0 alone because a
 * later phase's gate is unreachable until phase 0 clears, and filing work
 * nobody can start is worse than filing none. Phase 0 clears now.
 *
 * FILTERED BY `isPathDeliverable`, NOT BY A PHASE NUMBER. Phases 4 and 5
 * declare `ticket-board`, `fix-backlog` and `release-notes` — outputs of a
 * run, not documents anyone authors, with no file to write. That is the same
 * rule the phase gate itself applies when reading deliverables off disk, and
 * it now lives once, beside the topology. A phase that later gains a document
 * is picked up here with no change.
 */
function deliverableDrafts(
  existing: readonly string[],
): readonly TicketDraftInput[] {
  const have = new Set(existing);
  const drafts: TicketDraftInput[] = [];
  // PHASES is already in gate order, which is the order these must appear in:
  // a phase cannot be entered before its own documents exist.
  for (const phase of PHASES) {
    for (const deliverable of phase.deliverables) {
      if (!isPathDeliverable(deliverable.id)) continue;
      if (have.has(deliverable.id)) continue;
      drafts.push({
        id: `PHASE${phase.id}-${deliverableSlug(deliverable.id)}`,
        type: 'task' as const,
        title: `Write ${deliverable.id}`,
        writeScope: [deliverable.id],
        dependsOn: [],
        acceptance: [
          `${deliverable.id} exists and is written for a reader who has not seen this project before`,
          'It reflects what the interview actually established, not a template',
        ],
        // The phase gate re-checks existence itself; the ticket's own verify
        // asserts the file is there and not empty, so a close cannot claim it.
        verify: `test -s ${deliverable.id}`,
        // A doc-only ticket: no package, no code, no seams. Stated explicitly
        // rather than left off, because each is a seam the decomposer reasons
        // about and an omitted one is a guess.
        ownPackage: null,
        importsWorkspacePackages: [],
        providesInterfaces: [],
        consumesInterfaces: [],
      });
    }
  }
  return drafts;
}

/**
 * `docs/design/UX_SPEC.md` -> `design-UX_SPEC`. Keeps the id readable and
 * unique across phases: two phases could otherwise both yield `ARCHITECTURE`.
 */
function deliverableSlug(id: string): string {
  return id
    .replace(/^docs\//, '')
    .replace(/\.[^./]+$/, '')
    .replace(/\//g, '-');
}

export function runPipeline(input: RunPipelineInput, port: PipelinePort): DecomposedPlan {
  if (!isInterviewComplete(input.interviewSession)) {
    throw new IncompleteInterviewSessionError();
  }
  const drafts = collectDrafts(input.interviewSession);
  port.emit({ kind: 'interview-complete', topicCount: drafts.length });

  const blueprintInput = port.model.blueprintInputFrom(drafts, input.blueprintTitle);
  const blueprint = synthesizeBlueprint(blueprintInput);
  port.emit({ kind: 'blueprint-synthesized', version: blueprint.document.version });

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
    ...deliverableDrafts(input.existingDeliverables ?? []),
    ...port.model.ticketDraftsFrom(blueprint, technicalSlate),
  ];
  // W21-97: a plan built from someone's IDEA carries its quality work. This is
  // the call site that serves a person who may have no development experience
  // and would never think to ask for a security review — unlike
  // `buildFixBacklog`, whose input is already findings.
  const plan = decompose(ticketDrafts, { includeQualityWork: true });
  port.emit({ kind: 'decomposed', ticketCount: plan.tickets.length });

  return plan;
}
