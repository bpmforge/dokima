import fc from 'fast-check';
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

const unitFloatArb = fc.float({ min: 0, max: 1, noNaN: true });
const observationArb = fc.record({
  rawConfidence: unitFloatArb,
  verifiedConfidence: unitFloatArb,
});

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
    fc.assert(
      fc.property(fc.array(observationArb, { maxLength: 60 }), (observations) => {
        let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
        for (const observation of observations) {
          record = updateCalibration(record, observation, NOW);
          expect(record.bias).toBeGreaterThanOrEqual(0);
          expect(record.bias).toBeLessThanOrEqual(MAX_BIAS);
        }
      }),
    );
  });

  it('below MIN_SAMPLE_COUNT the bias is exactly 0', () => {
    fc.assert(
      fc.property(
        fc.array(observationArb, { minLength: 1, maxLength: MIN_SAMPLE_COUNT - 1 }),
        (observations) => {
          let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
          for (const observation of observations) {
            record = updateCalibration(record, observation, NOW);
          }
          expect(record.bias).toBe(0);
          expect(record.sampleCount).toBeLessThan(MIN_SAMPLE_COUNT);
        },
      ),
    );
  });

  it('applyCalibrationBias never applies bias when no anchor is present', () => {
    fc.assert(
      fc.property(
        unitFloatArb,
        fc.float({ min: 0, max: Math.fround(MAX_BIAS), noNaN: true }),
        fc.integer({ min: MIN_SAMPLE_COUNT, max: 1000 }),
        (rawConfidence, bias, sampleCount) => {
          const record = recordWith({ bias, sampleCount });
          const result = applyCalibrationBias(rawConfidence, record, false);
          expect(result.appliedBias).toBe(0);
          expect(result.adjustedConfidence).toBe(rawConfidence);
        },
      ),
    );
  });

  it(
    'applyCalibrationBias never produces a negative or out-of-clamp applied bias — ' +
      'the 2026-07-01 inversion regression case',
    () => {
      fc.assert(
        fc.property(
          unitFloatArb,
          // even a malformed/out-of-range stored bias must be re-clamped defensively
          fc.float({ min: -10, max: Math.fround(MAX_BIAS * 5), noNaN: true }),
          fc.integer({ min: 0, max: 1000 }),
          fc.boolean(),
          (rawConfidence, storedBias, sampleCount, anchorPresent) => {
            const record = recordWith({ bias: storedBias, sampleCount });
            const result = applyCalibrationBias(rawConfidence, record, anchorPresent);
            expect(result.appliedBias).toBeGreaterThanOrEqual(0);
            expect(result.appliedBias).toBeLessThanOrEqual(MAX_BIAS);
          },
        ),
      );
    },
  );
});

describe(
  'FR-L3: DONE requires anchor-present ∧ deterministic gate passed; ' +
    'bias ∈ [0, MAX_BIAS]; below min-sample the bias is 0',
  () => {
    it('gateDecision equals anchorIsPresent && deterministicGatePassed for every combination', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          (anchorIsPresent, deterministicGatePassed) => {
            expect(gateDecision({ anchorIsPresent, deterministicGatePassed })).toBe(
              anchorIsPresent && deterministicGatePassed,
            );
          },
        ),
      );
    });

    it('a DONE can never be manufactured from ungrounded confidence, at any bias or confidence', () => {
      fc.assert(
        fc.property(
          unitFloatArb,
          fc.float({ min: -10, max: Math.fround(MAX_BIAS * 5), noNaN: true }),
          fc.integer({ min: 0, max: 1000 }),
          fc.boolean(),
          fc.boolean(),
          (
            rawConfidence,
            storedBias,
            sampleCount,
            anchorIsPresentFlag,
            deterministicGatePassed,
          ) => {
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
          },
        ),
      );
    });
  },
);
