import { describe, expect, it } from 'vitest';
import {
  createCoverageTracker,
  phaseGatePasses,
  type CoverageUnitSpec,
} from './coverage.js';

function clockFrom(start: number): () => string {
  let tick = start;
  return () => new Date(tick++).toISOString();
}

/**
 * Conformance suite adapted from the source-system coverage-tracker
 * semantics (docs/research/source-system-foreman-jarvis.md §"Coverage
 * tracker", `src/orchestration/coverage-tracker.ts`) — behavior parity per
 * D-008, not code copying. Each test title quotes the source-derived
 * requirement it ports (SRS FR-L4 conformance column: "inventory→state
 * mappings including the WAIVED-attribution and SKIPPED-flagging cases;
 * end-of-phase report shape").
 */
describe('source-system coverage-tracker semantics conformance (docs/research/source-system-foreman-jarvis.md)', () => {
  it('"every expected unit ends DONE / BLOCKED / FAILED / SKIPPED / WAIVED — never disappears"', () => {
    const specs: CoverageUnitSpec[] = [
      { id: 'inv-1', description: 'done unit', required: true },
      { id: 'inv-2', description: 'blocked unit', required: true },
      { id: 'inv-3', description: 'failed unit', required: true },
      { id: 'inv-4', description: 'never-run required unit', required: true },
      { id: 'inv-5', description: 'waived unit', required: true },
    ];
    const tracker = createCoverageTracker(specs, { now: clockFrom(0) });
    tracker.complete('inv-1', 'DONE');
    tracker.complete('inv-2', 'BLOCKED');
    tracker.complete('inv-3', 'FAILED');
    // inv-4 never started or completed — the "expected-but-never-ran" case.
    tracker.waive('inv-5', { by: 'human:brad', reason: 'infeasible on this build' });

    const report = tracker.finalize();

    const statuses = new Map(report.units.map((u) => [u.spec.id, u.status]));
    expect(statuses.get('inv-1')).toBe('DONE');
    expect(statuses.get('inv-2')).toBe('BLOCKED');
    expect(statuses.get('inv-3')).toBe('FAILED');
    expect(statuses.get('inv-4')).toBe('SKIPPED');
    expect(statuses.get('inv-5')).toBe('WAIVED');
    // Inventory→state mapping is total: nothing missing, nothing extra.
    expect(report.units).toHaveLength(specs.length);
  });

  it('"SKIPPED = required-but-never-executed = a missed gate, loudly visible"', () => {
    const specs: CoverageUnitSpec[] = [
      { id: 'req-never-ran', description: '', required: true },
    ];
    const tracker = createCoverageTracker(specs, { now: clockFrom(0) });

    const report = tracker.finalize();

    expect(report.units[0]?.status).toBe('SKIPPED');
    expect(report.requiredSkipped).toContain('req-never-ran');
    expect(report.gatePasses).toBe(false);
    expect(phaseGatePasses(report)).toBe(false);
  });

  it('"WAIVED is intentional, recorded, never silent" — carries attribution end to end', () => {
    const specs: CoverageUnitSpec[] = [
      { id: 'waived-unit', description: '', required: true },
    ];
    const tracker = createCoverageTracker(specs, { now: clockFrom(0) });
    tracker.waive('waived-unit', { by: 'human:brad', reason: 'out of scope for W1 toy' });

    const report = tracker.finalize();

    const unit = report.units[0];
    expect(unit?.status).toBe('WAIVED');
    expect(unit?.waiver).not.toBeNull();
    expect(unit?.waiver?.by).toBe('human:brad');
    expect(unit?.waiver?.reason).toBe('out of scope for W1 toy');
    // A WAIVED required unit is not itself a gate failure — waiver != skip.
    expect(report.gatePasses).toBe(true);
  });

  it('"end-of-phase report shape" carries a total inventory count and a gate verdict', () => {
    const specs: CoverageUnitSpec[] = [
      { id: 'a', description: '', required: true },
      { id: 'b', description: '', required: false },
    ];
    const tracker = createCoverageTracker(specs, { now: clockFrom(0) });
    tracker.complete('a', 'DONE');
    tracker.complete('b', 'DONE');

    const report = tracker.finalize();

    expect(report).toMatchObject({
      generatedAt: expect.any(String),
      gatePasses: true,
      requiredSkipped: [],
    });
    expect(report.counts.DONE).toBe(2);
    const total = Object.values(report.counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(specs.length);
  });
});
