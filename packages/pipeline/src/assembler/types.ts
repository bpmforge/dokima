/**
 * Assembler types (P3-05).
 *
 * `BoardTicketRow` mirrors the plan.json/pipeline-board.json ticket row
 * shape — BOARD-plane data, so field names are snake_case (`write_scope`,
 * `depends_on`, `assembly_for`, `long_tail`), the same plane and convention
 * as `../seams/types.ts`' `wiring_evidence`/`provider_ticket`. This is NOT a
 * parallel model of `decompose`'s `DecomposedTicket` (an in-engine,
 * camelCase draft shape): rows here are what the conductor's board file
 * actually carries, and the assembler both reads them (`missingAssemblyTickets`,
 * `longTailGaps`, `assemblyGate`) and emits them (`generateAssemblyTickets`,
 * `generateLongTailWave`).
 */

export type BoardTicketStatus = 'todo' | 'in-progress' | 'done' | 'blocked';

/** One board ticket row, plan.json convention. Extra fields on real rows are
 * fine — the assembler only reads the ones named here. */
export interface BoardTicketRow {
  readonly id: string;
  readonly title: string;
  readonly lane: string;
  readonly write_scope: readonly string[];
  readonly acceptance: readonly string[];
  readonly points: number;
  readonly status: BoardTicketStatus;
  readonly depends_on?: readonly string[];
  /** Present on an assembly ticket: the seam id whose wiring this ticket proves. */
  readonly assembly_for?: string;
  /** Present (true) on a long-tail-wave ticket (the B-1 class). */
  readonly long_tail?: boolean;
  /** Which long-tail class the row covers (set by `generateLongTailWave`). */
  readonly long_tail_class?: string;
}
