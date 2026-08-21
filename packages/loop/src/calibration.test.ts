import { describe, expect, it } from 'vitest';
import {
  CalibrationError,
  MAX_BIAS,
  MIN_SAMPLE_COUNT,
  applyCalibrationBias,
  createCalibrationRecord,
  escalateIfOverclaiming,
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

describe('escalateIfOverclaiming (W15-02, FR-L3)', () => {
  const NOW = () => '2026-08-20T00:00:00.000Z';
  function history(rawVsVerified: [number, number][], model = 'm') {
    let record = createCalibrationRecord({ model, phase: 'coding-agent' }, NOW);
    for (const [rawConfidence, verifiedConfidence] of rawVsVerified) {
      record = updateCalibration(record, { rawConfidence, verifiedConfidence }, NOW);
    }
    return record;
  }

  it('RED FIXTURE: the same borderline score splits by track record — honest maker keeps BOUNDED_POLISH, chronic over-claimer goes to a person', () => {
    const honest = history(Array(6).fill([1, 1]) as [number, number][]);
    const overclaimer = history(Array(6).fill([1, 0]) as [number, number][]);

    expect(escalateIfOverclaiming('BOUNDED_POLISH', honest)).toEqual({
      action: 'BOUNDED_POLISH',
      overclaiming: false,
    });
    expect(escalateIfOverclaiming('BOUNDED_POLISH', overclaimer)).toEqual({
      action: 'ESCALATE_TO_HUMAN',
      overclaiming: true,
    });
  });

  it('RED FIXTURE: asymmetry is structural — an over-claimer never GAINS acceptance, and a clean ACCEPT is never revoked', () => {
    const overclaimer = history(Array(6).fill([1, 0]) as [number, number][]);
    // ACCEPT stays ACCEPT: the deterministic gate already passed and >=7 is
    // advisory over it; calibration only moves borderline work to a person.
    expect(escalateIfOverclaiming('ACCEPT', overclaimer).action).toBe('ACCEPT');
    expect(escalateIfOverclaiming('ESCALATE_TO_HUMAN', overclaimer).action).toBe(
      'ESCALATE_TO_HUMAN',
    );
  });

  it('below MIN_SAMPLE_COUNT the record is silent, exactly like bias', () => {
    const thin = history(Array(3).fill([1, 0]) as [number, number][]);
    expect(escalateIfOverclaiming('BOUNDED_POLISH', thin)).toEqual({
      action: 'BOUNDED_POLISH',
      overclaiming: false,
    });
    expect(escalateIfOverclaiming('BOUNDED_POLISH', undefined).overclaiming).toBe(false);
  });
});
