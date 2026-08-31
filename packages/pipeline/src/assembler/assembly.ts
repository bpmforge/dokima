/**
 * Assembly tickets (P3-05 AC2).
 *
 * THE GAP THIS CLOSES: when a seam's producer and consumers land in
 * DIFFERENT tickets, each ticket can be individually green while the wiring
 * between them was never anyone's deliverable (the W0-08/W1-02 class,
 * generalized). Every such cross-ticket seam therefore requires an ASSEMBLY
 * ticket — recognized by an `assembly_for: <seamId>` board field — whose
 * acceptance cites the seam's `wiring_evidence`, so `assertSeams` output and
 * the ticket's done-ness talk about the same file.
 *
 * Reuses `../seams/types.ts`' `Seam` union directly (L4: never a parallel
 * seam model).
 */

import type { Seam } from '../seams/index.js';
import type { BoardTicketRow } from './types.js';

/** A seam whose producer and consumer tickets differ needs assembly. */
export function seamCrossesTickets(seam: Seam): boolean {
  return (
    seam.provider_ticket !== undefined &&
    seam.consumer_ticket !== undefined &&
    seam.provider_ticket !== seam.consumer_ticket
  );
}

/**
 * The deterministic wiring-evidence statement for a seam — the sentence an
 * assembly ticket's acceptance must carry. Mirrors exactly what
 * `assertSeams` checks, so the acceptance and the build-time assertion can
 * never disagree about what "wired" means.
 */
export function wiringEvidenceStatement(seam: Seam): string {
  const ev = seam.wiring_evidence;
  if (seam.kind === 'export') {
    return `${ev.file} exists and exports ${seam.exportName} (seam ${seam.id})`;
  }
  if ('pattern' in ev && ev.pattern !== undefined) {
    return `${ev.file} exists and matches pattern ${JSON.stringify(ev.pattern)} (seam ${seam.id})`;
  }
  return `${ev.file} exists (seam ${seam.id})`;
}

function hasAssemblyTicket(seam: Seam, tickets: readonly BoardTicketRow[]): boolean {
  const file = seam.wiring_evidence.file;
  return tickets.some(
    (t) => t.assembly_for === seam.id && t.acceptance.some((a) => a.includes(file)),
  );
}

/**
 * Every cross-ticket seam lacking an assembly ticket. A ticket satisfies a
 * seam only when its `assembly_for` names the seam's id AND some acceptance
 * line references the seam's wiring-evidence file — an `assembly_for` row
 * whose acceptance never mentions the evidence is a label, not a proof, and
 * the seam still reports as missing (red-fixture stance).
 */
export function missingAssemblyTickets(
  seams: readonly Seam[],
  tickets: readonly BoardTicketRow[],
): Seam[] {
  return seams.filter((s) => seamCrossesTickets(s) && !hasAssemblyTicket(s, tickets));
}

export interface GenerateAssemblyTicketsOptions {
  /** Board lane for the emitted rows (default 'assembly'). */
  readonly lane?: string;
}

/**
 * Emit a board-shaped assembly ticket for every cross-ticket seam.
 * Deterministic fields: id `ASM-<seamId>`, `write_scope` = the evidence
 * file (+ the contract test when the seam names one), acceptance = the
 * wiring-evidence statement (+ contract-test existence), points 2 when a
 * contract test must be written alongside the wiring, else 1.
 */
export function generateAssemblyTickets(
  seams: readonly Seam[],
  opts: GenerateAssemblyTicketsOptions = {},
): BoardTicketRow[] {
  const lane = opts.lane ?? 'assembly';
  return seams.filter(seamCrossesTickets).map((seam) => {
    const acceptance = [wiringEvidenceStatement(seam)];
    const write_scope = [seam.wiring_evidence.file];
    if (seam.contract_test !== undefined) {
      acceptance.push(`${seam.contract_test} exists and passes (contract test)`);
      write_scope.push(seam.contract_test);
    }
    return {
      id: `ASM-${seam.id}`,
      title:
        `Assemble seam ${seam.id}: wire ${seam.provider_ticket ?? '?'} -> ` +
        `${seam.consumer_ticket ?? '?'} (${seam.kind})`,
      lane,
      write_scope,
      acceptance,
      points: seam.contract_test !== undefined ? 2 : 1,
      status: 'todo' as const,
      assembly_for: seam.id,
    };
  });
}
