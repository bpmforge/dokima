import { describe, expect, it } from 'vitest';
import {
  CalibrationError,
  MAX_BIAS,
  MIN_SAMPLE_COUNT,
  applyCalibrationBias,
  createCalibrationRecord,
  gateDecision,
  updateCalibration,
} from './calibration.js';

const NOW = () => '2026-07-12T00:00:00.000Z';

describe('createCalibrationRecord', () => {
  it('starts at bias 0, sampleCount 0', () => {
    const record = createCalibrationRecord({ model: 'gpt-fake', phase: '4' }, NOW);
    expect(record).toMatchObject({
      model: 'gpt-fake',
      phase: '4',
      bias: 0,
      sampleCount: 0,
      meanRawConf: 0,
      meanVerifiedConf: 0,
    });
  });
});

describe('updateCalibration', () => {
  it('rejects observations outside [0, 1]', () => {
    const record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
    expect(() =>
      updateCalibration(record, { rawConfidence: 1.5, verifiedConfidence: 0.5 }, NOW),
    ).toThrow(CalibrationError);
    expect(() =>
      updateCalibration(record, { rawConfidence: 0.5, verifiedConfidence: -0.1 }, NOW),
    ).toThrow(CalibrationError);
  });

  it('stays gated at 0 until MIN_SAMPLE_COUNT observations accumulate', () => {
    let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
    for (let i = 0; i < MIN_SAMPLE_COUNT - 1; i += 1) {
      record = updateCalibration(
        record,
        { rawConfidence: 0.4, verifiedConfidence: 0.9 },
        NOW,
      );
      expect(record.bias).toBe(0);
    }
    record = updateCalibration(
      record,
      { rawConfidence: 0.4, verifiedConfidence: 0.9 },
      NOW,
    );
    expect(record.sampleCount).toBe(MIN_SAMPLE_COUNT);
    expect(record.bias).toBeGreaterThan(0);
  });

  it('rescues under-confidence but never rewards over-confidence with a positive bias', () => {
    let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
    for (let i = 0; i < MIN_SAMPLE_COUNT; i += 1) {
      // model says 0.9 confident, but only ever verified 0.3 correct — overconfident.
      record = updateCalibration(
        record,
        { rawConfidence: 0.9, verifiedConfidence: 0.3 },
        NOW,
      );
    }
    expect(record.bias).toBe(0);
  });

  it('clamps a large under-confidence gap to MAX_BIAS', () => {
    let record = createCalibrationRecord({ model: 'm', phase: 'p' }, NOW);
    for (let i = 0; i < MIN_SAMPLE_COUNT; i += 1) {
      record = updateCalibration(
        record,
        { rawConfidence: 0.0, verifiedConfidence: 1.0 },
        NOW,
      );
    }
    expect(record.bias).toBe(MAX_BIAS);
  });
});

describe('applyCalibrationBias', () => {
  it('applies no bias without a record', () => {
    const result = applyCalibrationBias(0.5, undefined, true);
    expect(result).toEqual({
      rawConfidence: 0.5,
      appliedBias: 0,
      adjustedConfidence: 0.5,
    });
  });

  it('applies no bias below MIN_SAMPLE_COUNT even when anchor is present', () => {
    const record = {
      model: 'm',
      phase: 'p',
      bias: MAX_BIAS,
      sampleCount: MIN_SAMPLE_COUNT - 1,
      meanRawConf: 0,
      meanVerifiedConf: 0,
      updatedAt: NOW(),
    };
    const result = applyCalibrationBias(0.5, record, true);
    expect(result.appliedBias).toBe(0);
  });

  it('applies the clamped bias when anchor present and min-sample cleared', () => {
    const record = {
      model: 'm',
      phase: 'p',
      bias: MAX_BIAS,
      sampleCount: MIN_SAMPLE_COUNT,
      meanRawConf: 0,
      meanVerifiedConf: 0,
      updatedAt: NOW(),
    };
    const result = applyCalibrationBias(0.5, record, true);
    expect(result.appliedBias).toBe(MAX_BIAS);
    expect(result.adjustedConfidence).toBeCloseTo(0.5 + MAX_BIAS, 10);
  });

  it('never lets adjustedConfidence exceed 1', () => {
    const record = {
      model: 'm',
      phase: 'p',
      bias: MAX_BIAS,
      sampleCount: MIN_SAMPLE_COUNT,
      meanRawConf: 0,
      meanVerifiedConf: 0,
      updatedAt: NOW(),
    };
    const result = applyCalibrationBias(0.95, record, true);
    expect(result.adjustedConfidence).toBeLessThanOrEqual(1);
  });
});

describe('gateDecision (FR-L3)', () => {
  it('is true only when anchor present and deterministic gate passed', () => {
    expect(gateDecision({ anchorIsPresent: true, deterministicGatePassed: true })).toBe(
      true,
    );
    expect(gateDecision({ anchorIsPresent: true, deterministicGatePassed: false })).toBe(
      false,
    );
    expect(gateDecision({ anchorIsPresent: false, deterministicGatePassed: true })).toBe(
      false,
    );
    expect(gateDecision({ anchorIsPresent: false, deterministicGatePassed: false })).toBe(
      false,
    );
  });
});
