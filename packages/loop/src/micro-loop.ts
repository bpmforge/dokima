import { createHash } from 'node:crypto';

/**
 * Per-item micro-loop (BLUEPRINT §3.5, FR-L1): CRITERION -> PRODUCE -> EVIDENCE
 * -> SELF-VERIFY -> REVISE -> EXIT. One micro-loop covers exactly one work
 * item; lumped one-shot judgments over a whole phase are out of scope by
 * construction (there is no "phase" parameter here).
 */

export interface MicroLoopItem {
  readonly id: string;
  readonly description: string;
}

/** A criterion the model judged objectively decidable. */
export interface CriterionAccepted {
  readonly checkable: true;
  readonly statement: string;
}

/** Refuse-to-loop: no checkable criterion, so the loop never runs a pass. */
export interface CriterionRefused {
  readonly checkable: false;
  readonly reason: string;
}

export type CriterionResult = CriterionAccepted | CriterionRefused;

export interface MicroLoopGap {
  readonly id: string;
  readonly description: string;
}

export interface EvidenceAction {
  readonly kind: string;
  readonly detail: string;
  readonly result: string;
}

export interface ProduceInput {
  readonly item: MicroLoopItem;
  readonly criterion: string;
  readonly passNumber: number;
  /** Specific gaps from the previous failed pass, fed back verbatim (empty on pass 1). */
  readonly priorGaps: readonly MicroLoopGap[];
}

export interface ProduceResult {
  readonly output: unknown;
}

export interface EvidenceInput {
  readonly item: MicroLoopItem;
  readonly criterion: string;
  readonly produced: ProduceResult;
}

export interface SelfVerifyInput {
  readonly item: MicroLoopItem;
  readonly criterion: string;
  readonly produced: ProduceResult;
  readonly evidence: readonly EvidenceAction[];
}

export interface SelfVerifyResult {
  readonly passed: boolean;
  readonly gaps: readonly MicroLoopGap[];
}

export interface MicroLoopCallbacks {
  restateCriterion(item: MicroLoopItem): CriterionResult | Promise<CriterionResult>;
  produce(input: ProduceInput): ProduceResult | Promise<ProduceResult>;
  gatherEvidence(
    input: EvidenceInput,
  ): readonly EvidenceAction[] | Promise<readonly EvidenceAction[]>;
  selfVerify(input: SelfVerifyInput): SelfVerifyResult | Promise<SelfVerifyResult>;
}

export interface MicroLoopOptions {
  /** Bounded passes (BLUEPRINT §3.5 caps this at 2-3). Default 3. */
  readonly maxPasses?: number;
  /** EVIDENCE step bound (FR-L1: <=4 look-actions). Default 4. */
  readonly maxEvidenceActions?: number;
}

export interface MicroLoopPassRecord {
  readonly passNumber: number;
  readonly produced: ProduceResult;
  readonly evidence: readonly EvidenceAction[];
  readonly verify: SelfVerifyResult;
  /** null when the pass passed (no gaps to checksum). */
  readonly gapChecksum: string | null;
}

export interface MicroLoopManifest {
  readonly item: MicroLoopItem;
  readonly criterion: string;
  readonly produced: ProduceResult;
  readonly evidence: readonly EvidenceAction[];
  readonly verify: SelfVerifyResult;
  readonly passesUsed: number;
}

export interface MicroLoopDone {
  readonly status: 'DONE';
  readonly manifest: MicroLoopManifest;
  readonly passes: readonly MicroLoopPassRecord[];
}

export interface MicroLoopBlocked {
  readonly status: 'BLOCKED';
  readonly reason: string;
}

export type MicroLoopPartialReason = 'no-progress' | 'max-passes-exhausted';

export interface MicroLoopPartial {
  readonly status: 'PARTIAL';
  readonly reason: MicroLoopPartialReason;
  readonly lesson: string;
  readonly passes: readonly MicroLoopPassRecord[];
}

export type MicroLoopResult = MicroLoopDone | MicroLoopBlocked | MicroLoopPartial;

const DEFAULT_MAX_PASSES = 3;
const DEFAULT_MAX_EVIDENCE_ACTIONS = 4;

/** Deterministic checksum over a gap set, order-independent (FR-L1 no-progress kill). */
export function computeGapChecksum(gaps: readonly MicroLoopGap[]): string {
  const normalized = gaps
    .map((gap) => `${gap.id}\x00${gap.description}`)
    .sort()
    .join('\x01');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function buildLesson(
  item: MicroLoopItem,
  gaps: readonly MicroLoopGap[],
  reason: string,
): string {
  const gapLines = gaps.map((gap) => `- ${gap.id}: ${gap.description}`).join('\n');
  return `Item "${item.id}" exited PARTIAL (${reason}). Remaining gaps:\n${gapLines}`;
}

/**
 * Runs one bounded micro-loop for a single work item. Never trusts a raw
 * self-confidence number and never produces DONE without a passing
 * SELF-VERIFY (anchors/calibration that can rescue a borderline pass are a
 * separate concern, FR-L2/FR-L3 — this function is the un-anchored core).
 */
export async function runMicroLoop(
  item: MicroLoopItem,
  callbacks: MicroLoopCallbacks,
  options: MicroLoopOptions = {},
): Promise<MicroLoopResult> {
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  if (!Number.isInteger(maxPasses) || maxPasses < 1) {
    throw new RangeError(`maxPasses must be a positive integer, got ${maxPasses}`);
  }
  const maxEvidenceActions = options.maxEvidenceActions ?? DEFAULT_MAX_EVIDENCE_ACTIONS;
  if (!Number.isInteger(maxEvidenceActions) || maxEvidenceActions < 0) {
    throw new RangeError(
      `maxEvidenceActions must be a non-negative integer, got ${maxEvidenceActions}`,
    );
  }

  // CRITERION — refuse-to-loop when nothing checkable is decidable.
  const criterionResult = await callbacks.restateCriterion(item);
  if (!criterionResult.checkable) {
    return { status: 'BLOCKED', reason: criterionResult.reason };
  }
  const criterion = criterionResult.statement;

  const passes: MicroLoopPassRecord[] = [];
  let priorGaps: readonly MicroLoopGap[] = [];
  let priorGapChecksum: string | null = null;

  for (let passNumber = 1; passNumber <= maxPasses; passNumber += 1) {
    // PRODUCE — this item only, with the previous pass's specific gaps fed back.
    const produced = await callbacks.produce({ item, criterion, passNumber, priorGaps });

    // EVIDENCE — bounded look-actions grounding the self-check.
    const evidence = await callbacks.gatherEvidence({ item, criterion, produced });
    if (evidence.length > maxEvidenceActions) {
      throw new RangeError(
        `gatherEvidence returned ${evidence.length} actions, exceeding the bound of ` +
          `${maxEvidenceActions} (FR-L1 EVIDENCE step)`,
      );
    }

    // SELF-VERIFY — deterministic pass/fail with specific gaps on failure.
    const verify = await callbacks.selfVerify({ item, criterion, produced, evidence });

    if (verify.passed) {
      passes.push({ passNumber, produced, evidence, verify, gapChecksum: null });
      const manifest: MicroLoopManifest = {
        item,
        criterion,
        produced,
        evidence,
        verify,
        passesUsed: passNumber,
      };
      return { status: 'DONE', manifest, passes };
    }

    if (verify.gaps.length === 0) {
      throw new Error(
        `selfVerify failed for item "${item.id}" pass ${passNumber} with no gaps — ` +
          'REVISE requires specific-gap feedback (FR-L1)',
      );
    }

    // REVISE — gap-checksum no-progress kill: identical gap set two passes running.
    const gapChecksum = computeGapChecksum(verify.gaps);
    passes.push({ passNumber, produced, evidence, verify, gapChecksum });

    if (gapChecksum === priorGapChecksum) {
      return {
        status: 'PARTIAL',
        reason: 'no-progress',
        lesson: buildLesson(item, verify.gaps, 'identical gap set two passes running'),
        passes,
      };
    }

    priorGaps = verify.gaps;
    priorGapChecksum = gapChecksum;
  }

  const lastPass = passes[passes.length - 1];
  const lastGaps = lastPass ? lastPass.verify.gaps : [];
  return {
    status: 'PARTIAL',
    reason: 'max-passes-exhausted',
    lesson: buildLesson(item, lastGaps, `max passes (${maxPasses}) exhausted`),
    passes,
  };
}
