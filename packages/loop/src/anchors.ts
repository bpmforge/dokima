import type { MicroLoopItem } from './micro-loop.js';

/**
 * Anchor framework (BLUEPRINT §3.5 "Anchors", FR-L2): external ground truth
 * composed onto the micro-loop as facts the model must reconcile with,
 * rather than raw self-confidence. Every anchor kind implements the same
 * `gather` contract so the loop can compose an arbitrary anchor set into one
 * fact list for the prompt. The tool anchor is fully wired here (it turns
 * validator/scanner output into facts); the challenger and memory anchors
 * are stub implementations that satisfy the interface and the
 * borderline-confidence firing contract but never fabricate a fact — real
 * wiring lands in W5 (challenger) and W7 (memory).
 */

export type AnchorKind = 'tool' | 'memory' | 'challenger';

export interface AnchorFact {
  readonly kind: AnchorKind;
  /** e.g. validator name, memory finding id, challenger model. */
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

// --- Challenger anchor: interface + borderline-confidence firing contract, stub gather ---

export interface ChallengerVerdict {
  readonly model: string;
  readonly agrees: boolean;
  readonly rationale: string;
}

export interface ChallengerFireInput extends AnchorGatherInput {
  /** The primary model's self-reported confidence in [0, 1]. */
  readonly rawConfidence: number;
}

export interface ChallengerAnchor extends Anchor {
  readonly kind: 'challenger';
  /** BLUEPRINT §3.5: fires only on borderline confidence — cost-efficient. */
  shouldFire(input: ChallengerFireInput): boolean;
}

/** Below this, the model already knows it's unsure; above this, tool-backed confidence is trusted without a second opinion. */
export const CHALLENGER_BORDERLINE_LOW = 0.5;
export const CHALLENGER_BORDERLINE_HIGH = 0.85;

/**
 * Stub challenger anchor (full wiring W5): defines the borderline-firing
 * contract but never invokes a second model — `gather` always returns no
 * facts, honestly reflecting "not wired yet" rather than fabricating a
 * verdict.
 */
export function createStubChallengerAnchor(): ChallengerAnchor {
  return {
    kind: 'challenger',
    shouldFire(input) {
      return (
        input.rawConfidence >= CHALLENGER_BORDERLINE_LOW &&
        input.rawConfidence <= CHALLENGER_BORDERLINE_HIGH
      );
    },
    gather() {
      return [];
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
 * Stub memory anchor (full wiring W7): satisfies the `gather` contract but
 * returns no facts until the memory service (packages/memory) exists to
 * back it.
 */
export function createStubMemoryAnchor(): MemoryAnchor {
  return {
    kind: 'memory',
    gather() {
      return [];
    },
  };
}
