/**
 * Calibration persistence (DATABASE.md §5, FR-L3). Pure storage: the
 * rescue-only bias math (never manufacture confidence, only ever rescue an
 * under-confident report) lives in `packages/loop/src/calibration.ts`'s
 * `CalibrationRecord`/`updateCalibration` — `memory` may not import `loop`
 * (ARCHITECTURE.md §4, loop depends on memory, never the reverse), so this
 * module is shaped structurally identical (same field names) to let a
 * caller round-trip loop's own record through `getCalibration`/
 * `upsertCalibration` with zero adapter code. `anchor.test.ts` proves the
 * structural match against the real loop package.
 */
import type { SqliteHandle } from './handle.js';

export interface CalibrationRecord {
  readonly model: string;
  readonly phase: string;
  readonly bias: number;
  readonly sampleCount: number;
  readonly meanRawConf: number;
  readonly meanVerifiedConf: number;
  readonly updatedAt: string;
}

interface CalibrationRow {
  model: string;
  phase: string;
  bias: number;
  sample_count: number;
  mean_raw_conf: number;
  mean_verified_conf: number;
  updated_at: string;
}

function toRecord(row: CalibrationRow): CalibrationRecord {
  return {
    model: row.model,
    phase: row.phase,
    bias: row.bias,
    sampleCount: row.sample_count,
    meanRawConf: row.mean_raw_conf,
    meanVerifiedConf: row.mean_verified_conf,
    updatedAt: row.updated_at,
  };
}

export function getCalibration(
  handle: SqliteHandle,
  model: string,
  phase: string,
): CalibrationRecord | undefined {
  const row = handle
    .prepare<CalibrationRow>('SELECT * FROM calibration WHERE model = ? AND phase = ?')
    .get(model, phase);
  return row ? toRecord(row) : undefined;
}

/** Insert-or-replace on the (model, phase) primary key — the caller owns the full record. */
export function upsertCalibration(handle: SqliteHandle, record: CalibrationRecord): void {
  handle
    .prepare(
      `INSERT INTO calibration (model, phase, bias, sample_count, mean_raw_conf, mean_verified_conf, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (model, phase) DO UPDATE SET
         bias = excluded.bias,
         sample_count = excluded.sample_count,
         mean_raw_conf = excluded.mean_raw_conf,
         mean_verified_conf = excluded.mean_verified_conf,
         updated_at = excluded.updated_at`,
    )
    .run(
      record.model,
      record.phase,
      record.bias,
      record.sampleCount,
      record.meanRawConf,
      record.meanVerifiedConf,
      record.updatedAt,
    );
}

export function listCalibration(handle: SqliteHandle): CalibrationRecord[] {
  const rows = handle
    .prepare<CalibrationRow>('SELECT * FROM calibration ORDER BY model, phase')
    .all();
  return rows.map(toRecord);
}
