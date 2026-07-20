/**
 * Reads the real, persisted founder-decisions ledger for a project — the
 * `ledgerMarkdown` `assertDecisionComplete` cross-checks a blueprint's
 * `FOUNDER-DECISION ... RESOLVED` markers against (`packages/pipeline/src/
 * run/types.ts`'s own doc comment: "Current `docs/DECISIONS.md` content").
 *
 * This is the SELF-ATTEST FIX (Law 4/C-3): a decision is only real if this
 * function can see it, and this function only ever reads the project's own
 * file on disk — never anything an HTTP caller supplied. W5-13 (the
 * decisions API + DB projection) is blocked and unmerged, so a per-project
 * `docs/DECISIONS.md` file is the only real, already-persisted source of
 * truth available today; if/when W5-13 lands, this is the seam that would
 * switch to reading its DB projection instead.
 *
 * A missing file (fresh project, zero decisions made yet) is a legitimate
 * empty ledger, not an error — `assertDecisionComplete` already treats `''`
 * as valid (it just can't satisfy any RESOLVED marker's D-ID citation).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readLedgerMarkdown(projectPath: string): Promise<string> {
  const ledgerPath = path.join(projectPath, 'docs', 'DECISIONS.md');
  try {
    return await fs.readFile(ledgerPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}
