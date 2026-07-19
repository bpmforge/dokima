/**
 * `docs/DECISIONS.md` ledger mechanics: stable D-ID assignment, the
 * markdown row format, and appending — all pure text transforms, per this
 * module's write_scope (`packages/pipeline/src/decisions/**`): the wiring
 * ticket (W5-13, server route + `decisions` table) reads the real file,
 * calls these, and writes the result back. Nothing here touches the
 * filesystem, so a decided slate can never land as a side effect of
 * importing this module.
 */
import type { DecisionRecord } from './types.js';

const ID_LINE = /^\| (D-(\d+)) \|/;

/**
 * Scans every `D-<n>` occurrence in the ledger (table rows, not just the
 * line-start ones `ID_LINE` matches, since superseding rows like D-020 can
 * be appended out of numeric sequence — docs/DECISIONS.md's own history) and
 * returns the next stable ID, zero-padded to at least 3 digits.
 */
export function nextDecisionId(ledgerMarkdown: string): string {
  const matches = ledgerMarkdown.matchAll(/\bD-(\d+)\b/g);
  let max = 0;
  for (const m of matches) {
    const digits = m[1];
    if (digits === undefined) continue;
    const n = Number.parseInt(digits, 10);
    if (n > max) max = n;
  }
  const next = max + 1;
  return `D-${String(next).padStart(3, '0')}`;
}

/**
 * Escapes `|` and strips newlines so a rationale/decision string (agent/LLM
 * authored — untrusted per this project's trust-boundary law) can never
 * break out of its markdown table cell, whether by escaping the column
 * delimiter or by splitting into extra physical lines that would read as
 * forged ledger rows.
 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
}

export function formatLedgerRow(record: DecisionRecord): string {
  return (
    `| ${escapeCell(record.id)} | ${escapeCell(record.date)} | ${escapeCell(record.decision)} | ` +
    `${escapeCell(record.optionsConsidered)} | ${escapeCell(record.rationale)} |`
  );
}

export class LedgerTableNotFoundError extends Error {
  constructor() {
    super('no "| D-<n> |" row found — is this really docs/DECISIONS.md\'s ledger table?');
    this.name = 'LedgerTableNotFoundError';
  }
}

/**
 * Appends `record` as a new row immediately after the ledger table's last
 * existing `| D-... |` row (append-only — decisions are never edited or
 * reordered in place, DECISIONS.md's own header: "Do not re-litigate
 * without a new entry superseding the old one"). Everything else in the
 * file (the "Pending slates" section, constraints list, etc.) is preserved
 * byte-for-byte.
 */
export function appendDecision(ledgerMarkdown: string, record: DecisionRecord): string {
  const lines = ledgerMarkdown.split('\n');
  let lastRowIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && ID_LINE.test(line)) lastRowIndex = i;
  }
  if (lastRowIndex === -1) {
    throw new LedgerTableNotFoundError();
  }
  const newLines = [
    ...lines.slice(0, lastRowIndex + 1),
    formatLedgerRow(record),
    ...lines.slice(lastRowIndex + 1),
  ];
  return newLines.join('\n');
}

/**
 * Whether `text` cites `decisionId` (SRS FR-P6: "downstream docs cite
 * decision IDs; validator flags any doc restating a decided fork without
 * citing its D-ID"). A future doc-consistency validator (content/validators,
 * out of this ticket's write_scope) is the natural caller.
 */
export function citesDecisionId(text: string, decisionId: string): boolean {
  return new RegExp(`\\b${decisionId}\\b`).test(text);
}
