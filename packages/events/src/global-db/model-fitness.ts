import type { GlobalDb } from './db.js';

export type ModelFitnessVerdict = 'fit' | 'unfit' | 'marginal';

export interface ModelFitnessInput {
  readonly model: string;
  readonly role: string;
  readonly verdict: ModelFitnessVerdict;
  readonly harnessVersion: string;
  /** JSON-serializable evidence for the verdict (e.g. per-task bench results) — DATABASE.md §7's receipt_payload. */
  readonly receiptPayload: unknown;
  readonly runAt: string;
}

export type ModelFitnessRecord = ModelFitnessInput;

interface ModelFitnessRow {
  model: string;
  role: string;
  verdict: ModelFitnessVerdict;
  harness_version: string;
  receipt_payload: string;
  run_at: string;
}

function rowToRecord(row: ModelFitnessRow): ModelFitnessRecord {
  return {
    model: row.model,
    role: row.role,
    verdict: row.verdict,
    harnessVersion: row.harness_version,
    receiptPayload: JSON.parse(row.receipt_payload) as unknown,
    runAt: row.run_at,
  };
}

/** Upserts a fitness card, keyed (model, role, harness_version) per DATABASE.md §7's model_fitness PK — a rebench of the same triple replaces the prior verdict. */
export function putModelFitness(global: GlobalDb, input: ModelFitnessInput): void {
  global.db
    .prepare(
      `INSERT INTO model_fitness (model, role, verdict, harness_version, receipt_payload, run_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (model, role, harness_version) DO UPDATE SET
         verdict = excluded.verdict,
         receipt_payload = excluded.receipt_payload,
         run_at = excluded.run_at`,
    )
    .run(
      input.model,
      input.role,
      input.verdict,
      input.harnessVersion,
      JSON.stringify(input.receiptPayload),
      input.runAt,
    );
}

export function getModelFitness(
  global: GlobalDb,
  model: string,
  role: string,
  harnessVersion: string,
): ModelFitnessRecord | undefined {
  const row = global.db
    .prepare<[string, string, string], ModelFitnessRow>(
      'SELECT * FROM model_fitness WHERE model = ? AND role = ? AND harness_version = ?',
    )
    .get(model, role, harnessVersion);
  return row ? rowToRecord(row) : undefined;
}

export function listModelFitness(global: GlobalDb): ModelFitnessRecord[] {
  const rows = global.db
    .prepare<[], ModelFitnessRow>(
      'SELECT * FROM model_fitness ORDER BY model, role, harness_version',
    )
    .all();
  return rows.map(rowToRecord);
}
