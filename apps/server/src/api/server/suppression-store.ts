/** Suppression review list persistence (FR-RL3, DATABASE.md §5b): justification-gated, human-signed, auto-reopens on context-key mismatch. */

import { withSettingsReader, withSettingsWriter } from './settings-db.js';
import type { SuppressionJustification, SuppressionRow } from './settings-types.js';

interface SuppressionSqlRow {
  id: number;
  fingerprint: string;
  rule_id: string | null;
  justification: string;
  signed_by: string;
  context_key: string;
  status: string;
  created_at: string;
  reopened_at: string | null;
}

function fromSqlRow(row: SuppressionSqlRow): SuppressionRow {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    ruleId: row.rule_id,
    justification: row.justification as SuppressionJustification,
    signedBy: row.signed_by,
    contextKey: row.context_key,
    status: row.status as SuppressionRow['status'],
    createdAt: row.created_at,
    reopenedAt: row.reopened_at,
  };
}

const SELECT_ALL = 'SELECT * FROM suppressions ORDER BY created_at DESC';

export async function listSuppressions(projectPath: string): Promise<SuppressionRow[]> {
  return withSettingsReader(projectPath, [], (db) => {
    const rows = db.prepare(SELECT_ALL).all() as SuppressionSqlRow[];
    return rows.map(fromSqlRow);
  });
}

export interface SuppressionInput {
  readonly fingerprint: string;
  readonly ruleId: string | null;
  readonly justification: SuppressionJustification;
  readonly signedBy: string;
  readonly contextKey: string;
}

export async function createSuppression(
  projectPath: string,
  input: SuppressionInput,
  now: () => string = () => new Date().toISOString(),
): Promise<SuppressionRow> {
  return withSettingsWriter(projectPath, (db) => {
    const nowIso = now();
    const result = db
      .prepare(
        `INSERT INTO suppressions (fingerprint, rule_id, justification, signed_by, context_key, status, created_at)
         VALUES (@fingerprint, @ruleId, @justification, @signedBy, @contextKey, 'active', @createdAt)`,
      )
      .run({
        fingerprint: input.fingerprint,
        ruleId: input.ruleId,
        justification: input.justification,
        signedBy: input.signedBy,
        contextKey: input.contextKey,
        createdAt: nowIso,
      });
    const row = db
      .prepare('SELECT * FROM suppressions WHERE id = ?')
      .get(result.lastInsertRowid) as SuppressionSqlRow;
    return fromSqlRow(row);
  });
}

/** FR-RL3: reopens a suppression whose context_key no longer matches the current one (rule version/file hash/dep version changed). */
export async function reopenIfContextChanged(
  projectPath: string,
  id: number,
  currentContextKey: string,
  now: () => string = () => new Date().toISOString(),
): Promise<SuppressionRow | undefined> {
  return withSettingsWriter(projectPath, (db) => {
    const sqlRow = db.prepare('SELECT * FROM suppressions WHERE id = ?').get(id) as
      SuppressionSqlRow | undefined;
    if (!sqlRow) return undefined;
    if (sqlRow.context_key === currentContextKey || sqlRow.status === 'reopened') {
      return fromSqlRow(sqlRow);
    }
    const nowIso = now();
    db.prepare(
      `UPDATE suppressions SET status = 'reopened', reopened_at = ? WHERE id = ?`,
    ).run(nowIso, id);
    return fromSqlRow(
      db.prepare('SELECT * FROM suppressions WHERE id = ?').get(id) as SuppressionSqlRow,
    );
  });
}
