import { describe, expect, it } from 'vitest';
import {
  CoverageError,
  createCoverageTracker,
  phaseGatePasses,
  toCoverageReportJson,
  toCoverageReportMarkdown,
  type CoverageUnitSpec,
} from './coverage.js';

const SPECS: CoverageUnitSpec[] = [
  { id: 'unit-a', description: 'implement pop()', required: true },
  { id: 'unit-b', description: 'implement push()', required: true },
  { id: 'unit-c', description: 'write README note', required: false },
];

function clockFrom(start: number): () => string {
  let tick = start;
  return () => new Date(tick++).toISOString();
}

describe('createCoverageTracker', () => {
  it('starts every unit PENDING', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    expect(tracker.units.map((u) => u.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
  });

  it('start() moves a unit to RUNNING and emits coverage.unit.started', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.start('unit-a');
    expect(tracker.units.find((u) => u.spec.id === 'unit-a')?.status).toBe('RUNNING');
    expect(tracker.events).toEqual([
      { eventType: 'coverage.unit.started', payload: { unitId: 'unit-a' } },
    ]);
  });

  it('complete() accepts DONE/FAILED/BLOCKED and records detail', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.start('unit-a');
    tracker.complete('unit-a', 'DONE', 'pop() implemented and tested');
    const unit = tracker.units.find((u) => u.spec.id === 'unit-a');
    expect(unit?.status).toBe('DONE');
    expect(unit?.detail).toBe('pop() implemented and tested');
  });

  it('complete() works directly from PENDING (no start() required)', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.complete('unit-a', 'FAILED');
    expect(tracker.units.find((u) => u.spec.id === 'unit-a')?.status).toBe('FAILED');
  });

  it('waive() requires a non-empty "by" and "reason" (FR-L4 attribution)', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    expect(() =>
      tracker.waive('unit-c', { by: '', reason: 'not needed for the toy' }),
    ).toThrow(CoverageError);
    expect(() => tracker.waive('unit-c', { by: 'human:brad', reason: '  ' })).toThrow(
      CoverageError,
    );
    // Neither rejected attempt mutated the unit.
    expect(tracker.units.find((u) => u.spec.id === 'unit-c')?.status).toBe('PENDING');
  });

  it('waive() with attribution records the waiver on the unit and event', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.waive('unit-c', {
      by: 'human:brad',
      reason: 'out of scope for the toy project',
    });
    const unit = tracker.units.find((u) => u.spec.id === 'unit-c');
    expect(unit?.status).toBe('WAIVED');
    expect(unit?.waiver).toEqual({
      by: 'human:brad',
      reason: 'out of scope for the toy project',
    });
    expect(tracker.events.at(-1)).toEqual({
      eventType: 'coverage.unit.waived',
      payload: {
        unitId: 'unit-c',
        by: 'human:brad',
        reason: 'out of scope for the toy project',
      },
    });
  });

  it('rejects an unknown unit id', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    expect(() => tracker.start('unit-nope')).toThrow(CoverageError);
    try {
      tracker.start('unit-nope');
    } catch (err) {
      expect(err).toBeInstanceOf(CoverageError);
      expect((err as CoverageError).code).toBe('UNKNOWN_UNIT');
    }
  });

  it('rejects a transition on a unit that already ended', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.complete('unit-a', 'DONE');
    expect(() => tracker.complete('unit-a', 'FAILED')).toThrow(CoverageError);
    expect(() => tracker.start('unit-a')).toThrow(CoverageError);
    expect(() => tracker.waive('unit-a', { by: 'x', reason: 'y' })).toThrow(
      CoverageError,
    );
  });

  it('rejects a duplicate unit id in the inventory', () => {
    expect(() =>
      createCoverageTracker([
        { id: 'dup', description: 'a', required: true },
        { id: 'dup', description: 'b', required: true },
      ]),
    ).toThrow(CoverageError);
  });

  describe('finalize()', () => {
    it('leaves DONE/WAIVED/BLOCKED/FAILED units untouched', () => {
      const tracker = createCoverageTracker(
        [
          { id: 'a', description: '', required: true },
          { id: 'b', description: '', required: true },
          { id: 'c', description: '', required: false },
          { id: 'd', description: '', required: false },
        ],
        { now: clockFrom(0) },
      );
      tracker.complete('a', 'DONE');
      tracker.complete('b', 'FAILED');
      tracker.complete('c', 'BLOCKED');
      tracker.waive('d', { by: 'human:brad', reason: 'not applicable' });

      const report = tracker.finalize();

      expect(report.units.map((u) => u.status)).toEqual([
        'DONE',
        'FAILED',
        'BLOCKED',
        'WAIVED',
      ]);
    });

    it('converts required PENDING/RUNNING units to SKIPPED and fails the gate', () => {
      const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
      tracker.start('unit-a'); // left RUNNING
      // unit-b left PENDING, unit-c left PENDING

      const report = tracker.finalize();

      const byId = new Map(report.units.map((u) => [u.spec.id, u]));
      expect(byId.get('unit-a')?.status).toBe('SKIPPED');
      expect(byId.get('unit-b')?.status).toBe('SKIPPED');
      expect(byId.get('unit-c')?.status).toBe('SKIPPED');
      expect([...report.requiredSkipped].sort()).toEqual(['unit-a', 'unit-b']);
      expect(report.gatePasses).toBe(false);
      expect(phaseGatePasses(report)).toBe(false);
    });

    it('SKIPPED optional units are reported but do not fail the gate', () => {
      const tracker = createCoverageTracker(
        [
          { id: 'required-1', description: '', required: true },
          { id: 'optional-1', description: '', required: false },
        ],
        { now: clockFrom(0) },
      );
      tracker.complete('required-1', 'DONE');
      // optional-1 left PENDING -> SKIPPED at finalize, but it's not required.

      const report = tracker.finalize();

      expect(report.requiredSkipped).toEqual([]);
      expect(report.gatePasses).toBe(true);
      const optional = report.units.find((u) => u.spec.id === 'optional-1');
      expect(optional?.status).toBe('SKIPPED');
    });

    it('every unit ends in exactly one of the five terminal statuses (FR-L4 invariant)', () => {
      const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
      tracker.complete('unit-a', 'DONE');
      // unit-b left PENDING, unit-c left PENDING.

      const report = tracker.finalize();

      const terminal = new Set(['DONE', 'WAIVED', 'BLOCKED', 'FAILED', 'SKIPPED']);
      expect(report.units.every((u) => terminal.has(u.status))).toBe(true);
      const sum = Object.values(report.counts).reduce((total, n) => total + n, 0);
      expect(sum).toBe(SPECS.length);
      expect(sum).toBe(report.units.length);
    });

    it('refuses a second finalize() call', () => {
      const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
      tracker.finalize();
      expect(() => tracker.finalize()).toThrow(CoverageError);
    });

    it('refuses further transitions after finalize()', () => {
      const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
      tracker.finalize();
      expect(() => tracker.complete('unit-a', 'DONE')).toThrow(CoverageError);
    });

    it('emits a coverage.report.generated event carrying the gate verdict', () => {
      const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
      tracker.complete('unit-a', 'DONE');
      tracker.complete('unit-b', 'DONE');
      tracker.complete('unit-c', 'DONE');

      const report = tracker.finalize();

      expect(tracker.events.at(-1)).toEqual({
        eventType: 'coverage.report.generated',
        payload: { generatedAt: report.generatedAt, gatePasses: true },
      });
    });
  });
});

describe('report serialization', () => {
  it('toCoverageReportJson round-trips the report shape', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.complete('unit-a', 'DONE');
    tracker.waive('unit-b', { by: 'human:brad', reason: 'descoped' });
    const report = tracker.finalize();

    const parsed = JSON.parse(toCoverageReportJson(report)) as {
      gatePasses: boolean;
      units: Array<{ id: string; status: string; waiver: unknown }>;
    };

    expect(parsed.gatePasses).toBe(true);
    expect(parsed.units).toHaveLength(3);
    const waived = parsed.units.find((u) => u.id === 'unit-b');
    expect(waived?.status).toBe('WAIVED');
    expect(waived?.waiver).toEqual({ by: 'human:brad', reason: 'descoped' });
  });

  it('toCoverageReportMarkdown renders a table with the gate verdict and SKIPPED flag', () => {
    const tracker = createCoverageTracker(SPECS, { now: clockFrom(0) });
    tracker.complete('unit-a', 'DONE');
    // unit-b (required) and unit-c (optional) left PENDING -> SKIPPED.
    const report = tracker.finalize();

    const markdown = toCoverageReportMarkdown(report);

    expect(markdown).toContain('# COVERAGE_REPORT');
    expect(markdown).toContain('Gate: FAIL');
    expect(markdown).toContain('unit-a');
    expect(markdown).toContain('SKIPPED');
    expect(markdown).toContain('SKIPPED required units block the gate:** unit-b');
  });
});
