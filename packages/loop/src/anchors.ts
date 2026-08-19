import type { MicroLoopItem } from './micro-loop.js';

/**
 * Anchor framework (BLUEPRINT §3.5 "Anchors", FR-L2): external ground truth
 * composed onto the micro-loop as facts the model must reconcile with,
 * rather than raw self-confidence. Every anchor kind implements the same
 * `gather` contract so the loop can compose an arbitrary anchor set into one
 * fact list for the prompt.
 *
 * WHAT IS ACTUALLY HERE, corrected 2026-08-19 (W13-21). This header used to
 * promise that "real wiring lands in W5 (challenger) and W7 (memory)". Both
 * waves shipped and neither wiring landed here, because neither ticket's
 * write_scope included this file — so the comment kept assigning the work to
 * someone who was never going to arrive. A stub naming a wave that has already
 * passed reads as scheduled rather than as a gap, which is worse than a TODO.
 *
 *  - TOOL anchor: fully wired, and the one that matters. `gateway-session.ts`
 *    composes it from validator output on every iteration, which is what
 *    satisfies calibration's "applies only when an external anchor is present".
 *  - CHALLENGER anchor: REMOVED, not deferred. BLUEPRINT §3.5 step 4 asks for
 *    an independent verifier model "only where no oracle exists" — and a
 *    build-run session always has one, the ticket's own `verify`, re-run out of
 *    process by the close gate (SC-02). Where there genuinely is no oracle —
 *    research claims and report citability — the challenger IS wired, in
 *    `packages/pipeline/src/challenger`. It was already in the right place.
 *  - MEMORY anchor: the stub below is deliberately kept. A REAL implementation
 *    exists (`packages/memory/src/store/anchor.ts`) and cannot live here,
 *    because `memory` may not import `loop` (ARCHITECTURE §4). The stub is the
 *    control condition in `anti-jarvis-gap.test.ts`, which proves the real
 *    anchor recalls something where an inert one recalls nothing. Wiring the
 *    real one into a session needs a store handle it does not have: W13-23.
 */

// 'challenger' removed with the stub (W13-21): the loop has no challenger
// anchor, and the pipeline's challenger is not an Anchor.
export type AnchorKind = 'tool' | 'memory';

export interface AnchorFact {
  readonly kind: AnchorKind;
  /** e.g. validator name, or memory finding id. */
  readonly source: string;
  /** Human-readable fact the model must reconcile with. */
  readonly statement: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface AnchorGatherInput {
  readonly item: MicroLoopItem;
  readonly criterion: string;
}

export interface Anchor {
  readonly kind: AnchorKind;
  gather(
    input: AnchorGatherInput,
  ): readonly AnchorFact[] | Promise<readonly AnchorFact[]>;
}

/** Composes every anchor's facts into one ordered list (anchor order preserved). */
export async function gatherAnchorFacts(
  anchors: readonly Anchor[],
  input: AnchorGatherInput,
): Promise<readonly AnchorFact[]> {
  const perAnchor = await Promise.all(anchors.map((anchor) => anchor.gather(input)));
  return perAnchor.flat();
}

/** FR-L3's precondition: an anchor is present iff it produced at least one fact. */
export function anchorIsPresent(facts: readonly AnchorFact[]): boolean {
  return facts.length > 0;
}

/** Renders gathered facts as the "gather -> facts into prompt" block (FR-L2). */
export function formatAnchorFactsForPrompt(facts: readonly AnchorFact[]): string {
  if (facts.length === 0) {
    return '';
  }
  const lines = facts.map((fact) => `- [${fact.kind}:${fact.source}] ${fact.statement}`);
  return ['External anchor facts (reconcile before concluding):', ...lines].join('\n');
}

// --- Tool anchor: wired to validator/scanner output (docs/DATABASE.md `receipts.validators`) ---

/** Shape of one validator/scanner result, matching `receipts.validators` JSON rows. */
export interface ValidatorResult {
  readonly name: string;
  readonly exitCode: number;
  readonly gapCount: number;
  /** Specific gap descriptions surfaced by the validator, when it has them. */
  readonly gaps?: readonly string[];
}

function toolFact(result: ValidatorResult): AnchorFact {
  const passed = result.exitCode === 0 && result.gapCount === 0;
  const gapDetail =
    result.gaps && result.gaps.length > 0 ? ` — ${result.gaps.join('; ')}` : '';
  const statement = passed
    ? `validator "${result.name}" passed (exit 0, 0 gaps)`
    : `validator "${result.name}" failed: exit ${result.exitCode}, ${result.gapCount} gap(s)${gapDetail}`;
  return {
    kind: 'tool',
    source: result.name,
    statement,
    detail: { exitCode: result.exitCode, gapCount: result.gapCount, passed },
  };
}

/** Tool anchor: one fact per validator/scanner result, always present when results exist. */
export function createToolAnchor(results: readonly ValidatorResult[]): Anchor {
  return {
    kind: 'tool',
    gather() {
      return results.map(toolFact);
    },
  };
}

// --- Memory anchor: interface for prior confirmed findings, stub gather ---

export interface MemoryFinding {
  readonly id: string;
  readonly summary: string;
  /** Identity (verifier, not maker) that confirmed this finding — playbook entries are verified-before-stored. */
  readonly confirmedBy: string;
}

export type MemoryAnchor = Anchor & { readonly kind: 'memory' };

/**
 * The INERT memory anchor — kept on purpose (W13-21).
 *
 * Not "not wired yet": the real one exists in `packages/memory` and is
 * duck-typed against this contract because `memory` may not import `loop`.
 * This is the control condition `anti-jarvis-gap.test.ts` contrasts it with,
 * which is the whole demonstration that an unwired memory engine recalls
 * nothing. Deleting it would delete the proof.
 */
export function createStubMemoryAnchor(): MemoryAnchor {
  return {
    kind: 'memory',
    gather() {
      return [];
    },
  };
}
