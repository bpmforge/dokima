/**
 * Calibration bias (BLUEPRINT §3.5 "Calibration honesty", FR-L3): a learned
 * per-(model, phase) bias that can only ever rescue an under-confident
 * self-report, never manufacture ungrounded confidence. Clamped to
 * [0, MAX_BIAS] (docs/DATABASE.md `calibration.bias`), gated on a minimum
 * sample count, and applied only when an external anchor is present
 * (packages/loop/src/anchors.ts). The load-bearing invariant lives in
 * `gateDecision`: DONE is decided from anchor-presence and the
 * deterministic gate alone — no confidence value, biased or raw, ever
 * appears in that decision. This is the fix for the 2026-07-01 inversion
 * regression, where a sign error let bias go negative and self-confidence
 * alone flip a gate.
 */

/** Upper clamp on a rescue bias (docs/DATABASE.md `calibration.bias`). */
export const MAX_BIAS = 0.2;
/** Below this many samples, bias is forced to 0 regardless of the computed value. */
export const MIN_SAMPLE_COUNT = 5;

export interface CalibrationKey {
  readonly model: string;
  readonly phase: string;
}

export interface CalibrationRecord extends CalibrationKey {
  /** Rescue-only, clamped [0, MAX_BIAS]; 0 below MIN_SAMPLE_COUNT. */
  readonly bias: number;
  readonly sampleCount: number;
  readonly meanRawConf: number;
  readonly meanVerifiedConf: number;
  readonly updatedAt: string;
}

export interface CalibrationObservation {
  /** The model's self-reported confidence in [0, 1] for a verified pass. */
  readonly rawConfidence: number;
  /** The anchor-verified outcome confidence in [0, 1] (e.g. 1 = confirmed correct). */
  readonly verifiedConfidence: number;
}

export type CalibrationErrorCode = 'OUT_OF_RANGE';

export class CalibrationError extends Error {
  readonly code: CalibrationErrorCode;

  constructor(code: CalibrationErrorCode, message: string) {
    super(message);
    this.name = 'CalibrationError';
    this.code = code;
  }
}

function requireUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new CalibrationError(
      'OUT_OF_RANGE',
      `${label} must be within [0, 1], got ${value}`,
    );
  }
}

/** Rescue-only clamp: never negative (the inversion regression), never above MAX_BIAS. */
function clampBias(bias: number): number {
  if (!Number.isFinite(bias)) {
    return 0;
  }
  return Math.min(MAX_BIAS, Math.max(0, bias));
}

export function createCalibrationRecord(
  key: CalibrationKey,
  now: () => string,
): CalibrationRecord {
  return {
    ...key,
    bias: 0,
    sampleCount: 0,
    meanRawConf: 0,
    meanVerifiedConf: 0,
    updatedAt: now(),
  };
}

/**
 * Folds one anchor-verified observation into the running per-(model,phase)
 * means and recomputes bias as the *under*-confidence gap (verified - raw),
 * clamped to never go negative and never exceed MAX_BIAS. An overconfident
 * model (verified < raw) earns bias 0, not a penalty — bias only ever
 * rescues, it never punishes or amplifies.
 */
export function updateCalibration(
  record: CalibrationRecord,
  observation: CalibrationObservation,
  now: () => string,
): CalibrationRecord {
  requireUnitInterval(observation.rawConfidence, 'rawConfidence');
  requireUnitInterval(observation.verifiedConfidence, 'verifiedConfidence');
  const sampleCount = record.sampleCount + 1;
  const meanRawConf =
    record.meanRawConf + (observation.rawConfidence - record.meanRawConf) / sampleCount;
  const meanVerifiedConf =
    record.meanVerifiedConf +
    (observation.verifiedConfidence - record.meanVerifiedConf) / sampleCount;
  const bias =
    sampleCount >= MIN_SAMPLE_COUNT ? clampBias(meanVerifiedConf - meanRawConf) : 0;
  return {
    model: record.model,
    phase: record.phase,
    bias,
    sampleCount,
    meanRawConf,
    meanVerifiedConf,
    updatedAt: now(),
  };
}

export interface CalibratedConfidence {
  readonly rawConfidence: number;
  readonly appliedBias: number;
  readonly adjustedConfidence: number;
}

/**
 * Applies the rescue bias to a raw confidence — but only when an anchor is
 * present (FR-L3) and the record has cleared MIN_SAMPLE_COUNT; the stored
 * bias is re-clamped defensively rather than trusted as already valid.
 */
export function applyCalibrationBias(
  rawConfidence: number,
  record: CalibrationRecord | undefined,
  anchorIsPresent: boolean,
): CalibratedConfidence {
  requireUnitInterval(rawConfidence, 'rawConfidence');
  const gated =
    anchorIsPresent && record !== undefined && record.sampleCount >= MIN_SAMPLE_COUNT
      ? clampBias(record.bias)
      : 0;
  return {
    rawConfidence,
    appliedBias: gated,
    adjustedConfidence: Math.min(1, rawConfidence + gated),
  };
}

export interface GateInput {
  readonly anchorIsPresent: boolean;
  readonly deterministicGatePassed: boolean;
}

/**
 * The DONE decision (FR-L3's load-bearing invariant): anchor-present AND
 * deterministic-gate-passed, full stop. This function intentionally takes
 * no confidence parameter — raw or calibrated — which is the proof, at the
 * type level, that self-confidence cannot manufacture a DONE.
 */
export function gateDecision(input: GateInput): boolean {
  return input.anchorIsPresent && input.deterministicGatePassed;
}

/** A mean self-claim this far above the mean verified outcome marks a chronic over-claimer (W15-02). */
export const OVERCLAIM_GAP = 0.25;

export interface CalibratedReviewSignal {
  readonly action: 'ACCEPT' | 'BOUNDED_POLISH' | 'ESCALATE_TO_HUMAN';
  readonly overclaiming: boolean;
}

/**
 * Calibration's effect on a review signal (W15-02, FR-L3) — asymmetric BY
 * CONSTRUCTION, the same shape as the rescue-only bias above:
 *
 *   - Only a BORDERLINE signal (BOUNDED_POLISH) can be moved, and only
 *     DOWNWARD to ESCALATE_TO_HUMAN. A chronically over-claiming maker's
 *     borderline work goes to a person.
 *   - ACCEPT is never manufactured and never revoked here: a >=7 advisory
 *     over a passing deterministic gate stays what it is (the gate already
 *     passed; punishing it would blur advisory with gating — the
 *     classifyReviewSignal rule), and nothing below 7 can be promoted.
 *   - Below MIN_SAMPLE_COUNT the record is silent, exactly like bias.
 */
export function escalateIfOverclaiming(
  action: CalibratedReviewSignal['action'],
  record: CalibrationRecord | undefined,
): CalibratedReviewSignal {
  const overclaiming =
    record !== undefined &&
    record.sampleCount >= MIN_SAMPLE_COUNT &&
    record.meanRawConf - record.meanVerifiedConf >= OVERCLAIM_GAP;
  if (action === 'BOUNDED_POLISH' && overclaiming) {
    return { action: 'ESCALATE_TO_HUMAN', overclaiming };
  }
  return { action, overclaiming };
}
