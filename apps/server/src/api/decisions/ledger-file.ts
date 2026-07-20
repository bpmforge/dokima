/**
 * Reads/writes a project's real `docs/DECISIONS.md` (sync `node:fs`, not
 * `fs.promises`): `store.ts`'s `decideSlate` must read the current ledger,
 * compute the next D-ID, and write the updated ledger back with zero
 * `await` between those steps, or a second concurrent `decideSlate` call
 * could interleave on the same stale ledger snapshot and silently
 * corrupt the file (two rows racing for the same D-ID is a review-caught
 * HIGH from an earlier attempt at this ticket). Node is single-threaded,
 * so a fully synchronous read-compute-write critical section can't be
 * interleaved by another request's handler — no lockfile needed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  appendDecision,
  formatLedgerRow,
  LedgerTableNotFoundError,
  type DecisionRecord,
} from '@shipwright/pipeline';

const LEDGER_HEADER = [
  '# Decisions',
  '',
  '| ID | Date | Decision | Options considered | Rationale |',
  '|---|---|---|---|---|',
].join('\n');

export function ledgerPath(projectPath: string): string {
  return path.join(projectPath, 'docs', 'DECISIONS.md');
}

/** A missing ledger file (fresh project, zero decisions yet) is an honest empty ledger, not an error. */
export function readLedgerSync(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

export function writeLedgerSync(filePath: string, markdown: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, markdown, 'utf8');
}

/**
 * `@shipwright/pipeline`'s `appendDecision` refuses (`LedgerTableNotFoundError`)
 * when there's no existing `| D-<n> |` row to anchor after — deliberately,
 * per its own doc comment, since guessing where to insert a first row into
 * an ambiguous file is worse than refusing. That refusal is expected and
 * routine here: every project's very first decision has an empty or
 * table-less ledger. This wrapper seeds the standard header+table (or
 * appends it to whatever prose already exists) instead of failing.
 */
export function appendDecisionToLedger(markdown: string, record: DecisionRecord): string {
  if (markdown.trim().length === 0) {
    return `${LEDGER_HEADER}\n${formatLedgerRow(record)}\n`;
  }
  try {
    return appendDecision(markdown, record);
  } catch (err) {
    if (!(err instanceof LedgerTableNotFoundError)) throw err;
    const hasTable = markdown.includes('|---|---|---|---|---|');
    const suffix = hasTable
      ? formatLedgerRow(record)
      : [
          '',
          '| ID | Date | Decision | Options considered | Rationale |',
          '|---|---|---|---|---|',
          formatLedgerRow(record),
        ].join('\n');
    return `${markdown.replace(/\n+$/, '')}\n${suffix}\n`;
  }
}
