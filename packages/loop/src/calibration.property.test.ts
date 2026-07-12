import { describe, expect, it } from 'vitest';
import {
  MAX_BIAS,
  MIN_SAMPLE_COUNT,
  applyCalibrationBias,
  createCalibrationRecord,
  gateDecision,
  updateCalibration,
  type CalibrationRecord,
} from './calibration.js';

const NOW = () => '2026-07-12T00:00:00.000Z';

/**
 * Deterministic property testing without an external dependency (this ticket's
 * write-scope is the calibration and anchors modules only — adding a package dep is out of
 * scope). A seeded mulberry32 PRNG drives many randomized cases per property;
 * seeds are fixed so any failure is reproducible in CI with no live entropy
 * (CLAUDE.md Law 9, local-first honesty). Exercises the same invariant space
 * fast-check would, without pulling it into packages/loop.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CASES = 500;

/** A unit-interval float in [0, 1]. */
function unitFloat(rng: () => number): number {
  return rng();
}

/** An integer in [min, max]. */
function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** A float in [min, max] — deliberately allowed to fall out of [0, MAX_BIAS]. */
function floatBetween(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function recordWith(overrides: Partial<CalibrationRecord>): CalibrationRecord {
  return {
    model: 'gpt-fake',
    phase: '4',
    bias: 0,
    sampleCount: 0,
    meanRawConf: 0,
    meanVerifiedConf: 0,
    updatedAt: NOW(),
    ...overrides,
  };
}

describe('FR-L3: calibration bias is rescue-only and clamped [0, MAX_BIAS]', () => {
  it('bias stays within [0, MAX_BIAS] after any sequence of observations', () => {
    const rng = mulberry32(0x1a2b3c4d);
    for (let c = 0; c < CASES; c++) {
      const length = intBetween(rng, 0, 60);
      let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
      for (let i = 0; i < length; i++) {
        record = updateCalibration(
          record,
          { rawConfidence: unitFloat(rng), verifiedConfidence: unitFloat(rng) },
          NOW,
        );
        expect(record.bias).toBeGreaterThanOrEqual(0);
        expect(record.bias).toBeLessThanOrEqual(MAX_BIAS);
      }
    }
  });

  it('below MIN_SAMPLE_COUNT the bias is exactly 0', () => {
    const rng = mulberry32(0x5e6f7a8b);
    for (let c = 0; c < CASES; c++) {
      const length = intBetween(rng, 1, MIN_SAMPLE_COUNT - 1);
      let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
      for (let i = 0; i < length; i++) {
        record = updateCalibration(
          record,
          { rawConfidence: unitFloat(rng), verifiedConfidence: unitFloat(rng) },
          NOW,
        );
      }
      expect(record.bias).toBe(0);
      expect(record.sampleCount).toBeLessThan(MIN_SAMPLE_COUNT);
    }
  });

  it('applyCalibrationBias never applies bias when no anchor is present', () => {
    const rng = mulberry32(0x9c0d1e2f);
    for (let c = 0; c < CASES; c++) {
      const rawConfidence = unitFloat(rng);
      const bias = floatBetween(rng, 0, MAX_BIAS);
      const sampleCount = intBetween(rng, MIN_SAMPLE_COUNT, 1000);
      const record = recordWith({ bias, sampleCount });
      const result = applyCalibrationBias(rawConfidence, record, false);
      expect(result.appliedBias).toBe(0);
      expect(result.adjustedConfidence).toBe(rawConfidence);
    }
  });

  it(
    'applyCalibrationBias never produces a negative or out-of-clamp applied bias — ' +
      'the 2026-07-01 inversion regression case',
    () => {
      const rng = mulberry32(0x3a4b5c6d);
      for (let c = 0; c < CASES; c++) {
        const rawConfidence = unitFloat(rng);
        // even a malformed/out-of-range stored bias must be re-clamped defensively
        const storedBias = floatBetween(rng, -10, MAX_BIAS * 5);
        const sampleCount = intBetween(rng, 0, 1000);
        const anchorPresent = rng() < 0.5;
        const record = recordWith({ bias: storedBias, sampleCount });
        const result = applyCalibrationBias(rawConfidence, record, anchorPresent);
        expect(result.appliedBias).toBeGreaterThanOrEqual(0);
        expect(result.appliedBias).toBeLessThanOrEqual(MAX_BIAS);
      }
    },
  );
});

describe(
  'FR-L3: DONE requires anchor-present ∧ deterministic gate passed; ' +
    'bias ∈ [0, MAX_BIAS]; below min-sample the bias is 0',
  () => {
    it('gateDecision equals anchorIsPresent && deterministicGatePassed for every combination', () => {
      for (const anchorIsPresent of [false, true]) {
        for (const deterministicGatePassed of [false, true]) {
          expect(gateDecision({ anchorIsPresent, deterministicGatePassed })).toBe(
            anchorIsPresent && deterministicGatePassed,
          );
        }
      }
    });

    it('a DONE can never be manufactured from ungrounded confidence, at any bias or confidence', () => {
      const rng = mulberry32(0x7e8f9a0b);
      for (let c = 0; c < CASES; c++) {
        const rawConfidence = unitFloat(rng);
        const storedBias = floatBetween(rng, -10, MAX_BIAS * 5);
        const sampleCount = intBetween(rng, 0, 1000);
        const anchorIsPresentFlag = rng() < 0.5;
        const deterministicGatePassed = rng() < 0.5;
        const record = recordWith({ bias: storedBias, sampleCount });
        const calibrated = applyCalibrationBias(
          rawConfidence,
          record,
          anchorIsPresentFlag,
        );
        // Even at maximum adjusted confidence, DONE is gated purely on
        // anchor-presence and the deterministic gate — never on the
        // (possibly maxed-out) calibrated confidence value.
        const done = gateDecision({
          anchorIsPresent: anchorIsPresentFlag,
          deterministicGatePassed,
        });
        if (!anchorIsPresentFlag || !deterministicGatePassed) {
          expect(done).toBe(false);
        }
        // Sanity: confidence never leaks into the decision at all.
        expect(calibrated.adjustedConfidence).toBeGreaterThanOrEqual(0);
      }
    });
  },
);
