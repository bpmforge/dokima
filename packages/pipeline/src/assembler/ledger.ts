/**
 * Requirement coverage ledger (P3-05 AC1).
 *
 * THE GAP THIS CLOSES (the A-1 silent-divergence class): a board can drift
 * from the SRS — a requirement gets no ticket at all (`uncovered`), or gets
 * tickets whose "done" is never proven by an existing test
 * (`coded-not-done`) — and nothing notices, because every check so far took
 * the TICKET list as its universe.
 *
 * DENOMINATOR DISCIPLINE (the critical design rule): the requirement list is
 * an INPUT re-derived from the SRS source text via `deriveRequirementIds`,
 * and `requirementClosureGaps` iterates THAT list — never the ledger's keys,
 * never the ticket list. A requirement present in the SRS but absent from
 * every ticket (and therefore absent from any ticket-derived ledger) still
 * surfaces, as `uncovered`. Deriving the denominator from the tickets would
 * make the check a tautology.
 */

export type RequirementStatus = 'done' | 'coded-not-done' | 'uncovered';

/** Ledger row: which tickets implement a requirement and which test files
 * prove it. `status` is what the last gap computation concluded — data, not
 * authority; `requirementClosureGaps` always recomputes from evidence. */
export interface RequirementLedgerEntry {
  readonly implementingTickets: readonly string[];
  /** Paths of the tests that prove the requirement on main. */
  readonly provingTests: readonly string[];
  readonly status: RequirementStatus;
}

/** Requirement id (US-nnn / FR-…, as derived from SRS/USER_STORIES text) -> entry. */
export type RequirementLedger = Readonly<Record<string, RequirementLedgerEntry>>;

export interface RequirementGap {
  readonly requirementId: string;
  readonly status: Exclude<RequirementStatus, 'done'>;
  readonly detail: string;
}

export interface RequirementClosureOptions {
  /** THE DENOMINATOR — the output of `deriveRequirementIds(srsText)`.
   * Passing anything ticket-derived here defeats the check by design. */
  readonly requirementIds: readonly string[];
  /** Does this proving-test path exist on the head being gated? */
  readonly testExists: (path: string) => boolean;
}

const US_OR_FR = /\b(US-\d+|FR-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g;

/**
 * Extract every US-\d+ / FR-[A-Z0-9-]+ requirement id from real SRS /
 * USER_STORIES document text, deduplicated, in order of first appearance.
 * This — not the board — is where the gap check's denominator comes from.
 */
export function deriveRequirementIds(srsText: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of srsText.matchAll(US_OR_FR)) {
    const id = match[1] ?? '';
    if (id !== '' && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Report every requirement in `opts.requirementIds` (the SRS-derived
 * denominator) that is not closed:
 *   - no implementing ticket at all (missing ledger entry counts) →
 *     `uncovered` (A-1);
 *   - implementing tickets but no proving test that actually EXISTS per
 *     `opts.testExists` → `coded-not-done` (a listed-but-deleted test path
 *     proves nothing).
 * A requirement is closed only by tickets AND at least one existing proving
 * test. Ledger keys outside the denominator are ignored — they are stale
 * rows, not requirements.
 */
export function requirementClosureGaps(
  ledger: RequirementLedger,
  opts: RequirementClosureOptions,
): RequirementGap[] {
  const gaps: RequirementGap[] = [];
  for (const id of opts.requirementIds) {
    const entry = ledger[id];
    if (entry === undefined || entry.implementingTickets.length === 0) {
      gaps.push({
        requirementId: id,
        status: 'uncovered',
        detail: `${id} is in the SRS but no ticket implements it (A-1 silent divergence)`,
      });
      continue;
    }
    const existing = entry.provingTests.filter((p) => opts.testExists(p));
    if (existing.length === 0) {
      const listed =
        entry.provingTests.length === 0
          ? 'no proving test is listed'
          : `none of its listed proving tests exist (${entry.provingTests.join(', ')})`;
      gaps.push({
        requirementId: id,
        status: 'coded-not-done',
        detail:
          `${id} has implementing tickets (${entry.implementingTickets.join(', ')}) ` +
          `but ${listed}`,
      });
    }
  }
  return gaps;
}
