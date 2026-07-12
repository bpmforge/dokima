/**
 * Coverage tracker (BLUEPRINT §3.5 "Coverage Tracker", FR-L4): every expected
 * unit of work for a phase ends in exactly one of DONE / WAIVED / BLOCKED /
 * FAILED / SKIPPED — nothing disappears. `finalize()` closes out any unit
 * still PENDING/RUNNING as SKIPPED (expected-but-never-ran = a missed gate,
 * loudly flagged) and produces the COVERAGE_REPORT — a UI artifact and a
 * gate input (`phaseGatePasses`). This module is the pure engine (mirrors
 * micro-loop.ts): it returns report content and event-shaped records rather
 * than writing files or appending to the event log itself — persistence is
 * the orchestrator's job (harbormaster/pipeline), outside this write_scope.
 */

export type CoverageUnitStatus =
  'PENDING' | 'RUNNING' | 'DONE' | 'WAIVED' | 'BLOCKED' | 'FAILED' | 'SKIPPED';

/** FR-L4: every expected unit ends in exactly one of these five. */
export const TERMINAL_STATUSES: readonly CoverageUnitStatus[] = [
  'DONE',
  'WAIVED',
  'BLOCKED',
  'FAILED',
  'SKIPPED',
];

export interface CoverageUnitSpec {
  readonly id: string;
  readonly description: string;
  /** Required units block the phase gate when they end SKIPPED; optional ones are still reported but never gate. */
  readonly required: boolean;
}

/** FR-L4: WAIVED always carries attribution — never a silent skip. */
export interface WaiverAttribution {
  readonly by: string;
  readonly reason: string;
}

export interface CoverageUnitState {
  readonly spec: CoverageUnitSpec;
  readonly status: CoverageUnitStatus;
  readonly waiver: WaiverAttribution | null;
  readonly detail: string | null;
  readonly updatedAt: string;
}

export interface CoverageEvent {
  readonly eventType:
    | 'coverage.unit.started'
    | 'coverage.unit.completed'
    | 'coverage.unit.waived'
    | 'coverage.unit.skipped'
    | 'coverage.report.generated';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CoverageReport {
  readonly generatedAt: string;
  readonly units: readonly CoverageUnitState[];
  readonly counts: Readonly<Record<CoverageUnitStatus, number>>;
  /** ids of required units that ended SKIPPED — non-empty means the phase gate fails. */
  readonly requiredSkipped: readonly string[];
  readonly gatePasses: boolean;
}

export type CoverageErrorCode =
  'UNKNOWN_UNIT' | 'INVALID_TRANSITION' | 'MISSING_ATTRIBUTION';

export class CoverageError extends Error {
  readonly code: CoverageErrorCode;
  readonly unitId: string;

  constructor(code: CoverageErrorCode, unitId: string, message: string) {
    super(message);
    this.name = 'CoverageError';
    this.code = code;
    this.unitId = unitId;
  }
}

export interface CoverageTrackerOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  readonly now?: () => string;
}

export interface CoverageTracker {
  /** Snapshot of every unit's current state, insertion order. */
  readonly units: readonly CoverageUnitState[];
  /** Every event emitted so far, in order. */
  readonly events: readonly CoverageEvent[];
  /** PENDING -> RUNNING. */
  start(id: string): void;
  /** RUNNING|PENDING -> a terminal outcome other than WAIVED/SKIPPED. */
  complete(id: string, status: 'DONE' | 'FAILED' | 'BLOCKED', detail?: string): void;
  /** RUNNING|PENDING -> WAIVED; refuses without a non-empty attribution (FR-L4). */
  waive(id: string, attribution: WaiverAttribution, detail?: string): void;
  /**
   * Closes the phase: any unit still PENDING/RUNNING becomes SKIPPED, then
   * returns the COVERAGE_REPORT. Refuses on a second call — a report is a
   * one-shot snapshot of "the phase ended", not a live view.
   */
  finalize(): CoverageReport;
}

function requireNonEmpty(
  value: string,
  code: CoverageErrorCode,
  unitId: string,
  field: string,
): void {
  if (value.trim().length === 0) {
    throw new CoverageError(
      code,
      unitId,
      `waive refused: unit "${unitId}" requires a non-empty waiver ${field} — FR-L4 attribution`,
    );
  }
}

export function createCoverageTracker(
  specs: readonly CoverageUnitSpec[],
  opts: CoverageTrackerOptions = {},
): CoverageTracker {
  const now = opts.now ?? (() => new Date().toISOString());
  const ids = new Set<string>();
  const units = new Map<string, CoverageUnitState>();
  for (const spec of specs) {
    if (ids.has(spec.id)) {
      throw new CoverageError(
        'INVALID_TRANSITION',
        spec.id,
        `duplicate coverage unit id "${spec.id}" in inventory`,
      );
    }
    ids.add(spec.id);
    units.set(spec.id, {
      spec,
      status: 'PENDING',
      waiver: null,
      detail: null,
      updatedAt: now(),
    });
  }
  const events: CoverageEvent[] = [];
  let finalized = false;

  function requireUnit(id: string): CoverageUnitState {
    const unit = units.get(id);
    if (!unit) {
      throw new CoverageError(
        'UNKNOWN_UNIT',
        id,
        `coverage unit "${id}" is not in the inventory`,
      );
    }
    return unit;
  }

  function assertMutable(unit: CoverageUnitState, verb: string): void {
    if (finalized) {
      throw new CoverageError(
        'INVALID_TRANSITION',
        unit.spec.id,
        `${verb} refused: coverage tracker already finalized`,
      );
    }
    if (TERMINAL_STATUSES.includes(unit.status)) {
      throw new CoverageError(
        'INVALID_TRANSITION',
        unit.spec.id,
        `${verb} refused: unit "${unit.spec.id}" already ended ${unit.status}`,
      );
    }
  }

  return {
    get units() {
      return Array.from(units.values());
    },
    get events() {
      return events.slice();
    },
    start(id) {
      const unit = requireUnit(id);
      assertMutable(unit, 'start');
      units.set(id, { ...unit, status: 'RUNNING', updatedAt: now() });
      events.push({ eventType: 'coverage.unit.started', payload: { unitId: id } });
    },
    complete(id, status, detail) {
      const unit = requireUnit(id);
      assertMutable(unit, 'complete');
      units.set(id, { ...unit, status, detail: detail ?? null, updatedAt: now() });
      events.push({
        eventType: 'coverage.unit.completed',
        payload: { unitId: id, status, detail: detail ?? null },
      });
    },
    waive(id, attribution, detail) {
      const unit = requireUnit(id);
      assertMutable(unit, 'waive');
      requireNonEmpty(attribution.by, 'MISSING_ATTRIBUTION', id, '"by" identity');
      requireNonEmpty(attribution.reason, 'MISSING_ATTRIBUTION', id, 'reason');
      units.set(id, {
        ...unit,
        status: 'WAIVED',
        waiver: attribution,
        detail: detail ?? null,
        updatedAt: now(),
      });
      events.push({
        eventType: 'coverage.unit.waived',
        payload: { unitId: id, by: attribution.by, reason: attribution.reason },
      });
    },
    finalize() {
      if (finalized) {
        throw new CoverageError(
          'INVALID_TRANSITION',
          '*',
          'finalize refused: coverage tracker already finalized',
        );
      }
      finalized = true;
      for (const [id, unit] of units) {
        if (unit.status === 'PENDING' || unit.status === 'RUNNING') {
          units.set(id, { ...unit, status: 'SKIPPED', updatedAt: now() });
          events.push({
            eventType: 'coverage.unit.skipped',
            payload: { unitId: id, required: unit.spec.required, wasStatus: unit.status },
          });
        }
      }
      const report = buildReport(Array.from(units.values()), now());
      events.push({
        eventType: 'coverage.report.generated',
        payload: { generatedAt: report.generatedAt, gatePasses: report.gatePasses },
      });
      return report;
    },
  };
}

function buildReport(
  units: readonly CoverageUnitState[],
  generatedAt: string,
): CoverageReport {
  const counts: Record<CoverageUnitStatus, number> = {
    PENDING: 0,
    RUNNING: 0,
    DONE: 0,
    WAIVED: 0,
    BLOCKED: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
  for (const unit of units) counts[unit.status] += 1;
  const requiredSkipped = units
    .filter((unit) => unit.spec.required && unit.status === 'SKIPPED')
    .map((unit) => unit.spec.id);
  return {
    generatedAt,
    units,
    counts,
    requiredSkipped,
    gatePasses: requiredSkipped.length === 0,
  };
}

/** FR-L4 gate input: the phase gate fails on any SKIPPED required unit. */
export function phaseGatePasses(report: CoverageReport): boolean {
  return report.gatePasses;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Serializes the COVERAGE_REPORT.json artifact (BLUEPRINT §3.5). */
export function toCoverageReportJson(report: CoverageReport): string {
  return JSON.stringify(
    {
      generatedAt: report.generatedAt,
      gatePasses: report.gatePasses,
      counts: report.counts,
      requiredSkipped: report.requiredSkipped,
      units: report.units.map((unit) => ({
        id: unit.spec.id,
        description: unit.spec.description,
        required: unit.spec.required,
        status: unit.status,
        waiver: unit.waiver,
        detail: unit.detail,
        updatedAt: unit.updatedAt,
      })),
    },
    null,
    2,
  );
}

/** Renders the COVERAGE_REPORT.md artifact (BLUEPRINT §3.5) — a UI-readable gate input. */
export function toCoverageReportMarkdown(report: CoverageReport): string {
  const lines: string[] = [
    '# COVERAGE_REPORT',
    '',
    `Generated: ${report.generatedAt}`,
    `Gate: ${report.gatePasses ? 'PASS' : 'FAIL'}`,
    '',
    '| Unit | Required | Status | Waiver | Detail |',
    '|---|---|---|---|---|',
  ];
  for (const unit of report.units) {
    const waiver = unit.waiver ? `${unit.waiver.by}: ${unit.waiver.reason}` : '';
    lines.push(
      `| ${escapeCell(unit.spec.id)} | ${unit.spec.required ? 'yes' : 'no'} | ${unit.status} | ` +
        `${escapeCell(waiver)} | ${escapeCell(unit.detail ?? '')} |`,
    );
  }
  if (report.requiredSkipped.length > 0) {
    lines.push(
      '',
      `**SKIPPED required units block the gate:** ${report.requiredSkipped.join(', ')}`,
    );
  }
  return lines.join('\n');
}
