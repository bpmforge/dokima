/**
 * Assembly gate (P3-05 AC4) — the single release-candidate verdict over the
 * three assembler checks plus the built-head seam assertions.
 *
 * Passes ONLY when, independently:
 *   1. `requirementClosureGaps` is empty (no uncovered / coded-not-done
 *      requirement — denominator = the SRS-derived `requirementIds` input,
 *      per ledger.ts's discipline, never the ticket list);
 *   2. `missingAssemblyTickets` is empty (every cross-ticket seam has its
 *      assembly ticket);
 *   3. every `seamResults` entry is ok (`assertSeams` on the built head —
 *      the gate consumes P3-02's `SeamAssertion` rows, it never re-runs fs
 *      checks itself);
 *   4. the long-tail wave exists AND every `long_tail` ticket is done.
 * Each failing condition contributes its own gap strings; the fixture test
 * proves each one independently blocks.
 */

import type { Seam, SeamAssertion } from '../seams/index.js';
import { missingAssemblyTickets } from './assembly.js';
import { requirementClosureGaps } from './ledger.js';
import type { RequirementLedger } from './ledger.js';
import { longTailGaps } from './longtail.js';
import type { BoardTicketRow } from './types.js';

export interface AssemblyGateInput {
  readonly ledger: RequirementLedger;
  /** The SRS-derived denominator (`deriveRequirementIds` output) — required
   * here for the same reason `requirementClosureGaps` requires it: handing
   * the gate only the ledger would let stale ledgers shrink the universe. */
  readonly requirementIds: readonly string[];
  readonly seams: readonly Seam[];
  readonly tickets: readonly BoardTicketRow[];
  /** `assertSeams` output for the candidate head. */
  readonly seamResults: readonly SeamAssertion[];
  readonly testExists: (path: string) => boolean;
}

export interface AssemblyGateResult {
  readonly pass: boolean;
  readonly gaps: readonly string[];
}

export function assemblyGate(input: AssemblyGateInput): AssemblyGateResult {
  const gaps: string[] = [];

  for (const gap of requirementClosureGaps(input.ledger, {
    requirementIds: input.requirementIds,
    testExists: input.testExists,
  })) {
    gaps.push(`requirement ${gap.requirementId} is ${gap.status}: ${gap.detail}`);
  }

  for (const seam of missingAssemblyTickets(input.seams, input.tickets)) {
    gaps.push(
      `seam ${seam.id} crosses tickets (${seam.provider_ticket} -> ` +
        `${seam.consumer_ticket}) but no assembly ticket (assembly_for: ${seam.id}) ` +
        `cites its wiring evidence`,
    );
  }

  for (const result of input.seamResults) {
    if (!result.ok) {
      gaps.push(
        `seam ${result.seamId} failed its wiring assertion: ${result.reason ?? 'no reason recorded'}`,
      );
    }
  }

  for (const gap of longTailGaps(input.tickets)) {
    gaps.push(gap.detail);
  }
  for (const t of input.tickets) {
    if (t.long_tail === true && t.status !== 'done') {
      gaps.push(`long-tail ticket ${t.id} is ${t.status}, not done — the wave is open`);
    }
  }

  return { pass: gaps.length === 0, gaps };
}
