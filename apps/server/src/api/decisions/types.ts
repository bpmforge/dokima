/**
 * Decision slate row<->record mapping (DATABASE.md §4, `008_decisions.sql`).
 * The slate shape itself (`Slate` = `FounderSlate | TechnicalSlate`) is
 * `@shipwright/pipeline`'s — this file only adds the DB/wire wrapper around
 * it (status, chosen/rationale, the assigned D-ID).
 */
import type { Slate } from '@shipwright/pipeline';

export type SlateStatus = 'open' | 'decided';

export interface SlateRecord {
  id: string;
  status: SlateStatus;
  slate: Slate;
  chosen: string | null;
  rationale: string | null;
  dId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface DecisionRow {
  id: string;
  kind: string;
  title: string;
  slate: string;
  status: string;
  chosen: string | null;
  rationale: string | null;
  d_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export function rowToSlateRecord(row: DecisionRow): SlateRecord {
  return {
    id: row.id,
    status: row.status as SlateStatus,
    slate: JSON.parse(row.slate) as Slate,
    chosen: row.chosen,
    rationale: row.rationale,
    dId: row.d_id,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export class SlateNotFoundError extends Error {
  constructor(id: string) {
    super(`no open decision slate with id ${id}`);
    this.name = 'SlateNotFoundError';
  }
}

export class SlateAlreadyDecidedError extends Error {
  constructor(id: string) {
    super(`decision slate ${id} has already been decided`);
    this.name = 'SlateAlreadyDecidedError';
  }
}

export class InvalidChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidChoiceError';
  }
}
