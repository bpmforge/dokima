import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';
import { getCalibration, listCalibration, upsertCalibration } from './calibration.js';

describe('calibration store', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createTestHandle();
  });

  it('round-trips a record through upsert/get', () => {
    upsertCalibration(handle, {
      model: 'local-frontier',
      phase: 'implement',
      bias: 0.1,
      sampleCount: 5,
      meanRawConf: 0.6,
      meanVerifiedConf: 0.7,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(getCalibration(handle, 'local-frontier', 'implement')).toEqual({
      model: 'local-frontier',
      phase: 'implement',
      bias: 0.1,
      sampleCount: 5,
      meanRawConf: 0.6,
      meanVerifiedConf: 0.7,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
  });

  it('upsert replaces the row for the same (model, phase) key', () => {
    upsertCalibration(handle, {
      model: 'm',
      phase: 'p',
      bias: 0,
      sampleCount: 1,
      meanRawConf: 0.5,
      meanVerifiedConf: 0.5,
      updatedAt: 't1',
    });
    upsertCalibration(handle, {
      model: 'm',
      phase: 'p',
      bias: 0.2,
      sampleCount: 6,
      meanRawConf: 0.55,
      meanVerifiedConf: 0.75,
      updatedAt: 't2',
    });
    expect(getCalibration(handle, 'm', 'p')).toMatchObject({ sampleCount: 6, bias: 0.2 });
    expect(listCalibration(handle)).toHaveLength(1);
  });

  it('is undefined for an unknown (model, phase) pair', () => {
    expect(getCalibration(handle, 'nope', 'nope')).toBeUndefined();
  });

  it('keys are independent per (model, phase)', () => {
    upsertCalibration(handle, {
      model: 'm1',
      phase: 'p',
      bias: 0,
      sampleCount: 1,
      meanRawConf: 0.1,
      meanVerifiedConf: 0.1,
      updatedAt: 't',
    });
    upsertCalibration(handle, {
      model: 'm2',
      phase: 'p',
      bias: 0,
      sampleCount: 1,
      meanRawConf: 0.2,
      meanVerifiedConf: 0.2,
      updatedAt: 't',
    });
    expect(listCalibration(handle)).toHaveLength(2);
  });
});
