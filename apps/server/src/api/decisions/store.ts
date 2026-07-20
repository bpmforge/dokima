/**
 * Decision slate persistence (FR-P6, API_DESIGN "decisions & slates").
 * Every write happens directly against the already-open `EventLog.db`
 * handle (mirrors `apps/server/src/api/notifications/emit.ts`): the row and
 * its anchoring event land in one `db.transaction()`.
 *
 * `createSlate` validates through `@shipwright/pipeline`'s
 * `buildFounderSlate`/`buildTechnicalSlate` (FR-P6 2-4 options / R-H1's
 * fixed 3x6 grid) — this module never reimplements that validation, only
 * persists the result.
 *
 * ID-DERIVATION (W5-13 acceptance #2, W5-19): `decideSlate` gets its next
 * D-ID exclusively from `@shipwright/pipeline`'s hardened `nextDecisionId`,
 * which reads only the ledger's `| D-<n> |` ID column — never scanning
 * free-text cells (a slate's title/options/rationale is untrusted content
 * that could otherwise smuggle a `D-999`-shaped substring to jump the
 * sequence). This module must never re-derive that ID itself.
 */
import { randomUUID } from 'node:crypto';
import { appendEvent, type EventLog } from '@shipwright/events';
import {
  buildFounderSlate,
  buildTechnicalSlate,
  nextDecisionId,
  type DecisionRecord,
  type FounderSlateInput,
  type Slate,
  type TechnicalSlateInput,
} from '@shipwright/pipeline';
import {
  appendDecisionToLedger,
  ledgerPath,
  readLedgerSync,
  writeLedgerSync,
} from './ledger-file.js';
import {
  InvalidChoiceError,
  rowToSlateRecord,
  SlateAlreadyDecidedError,
  SlateNotFoundError,
  type DecisionRow,
  type SlateRecord,
  type SlateStatus,
} from './types.js';

export type CreateSlateInput =
  | { kind: 'founder'; founder: FounderSlateInput }
  | { kind: 'technical'; technical: TechnicalSlateInput };

export interface CreateSlateOptions {
  id?: string;
  actorId: string;
  now?: () => string;
}

export function createSlate(
  log: EventLog,
  input: CreateSlateInput,
  opts: CreateSlateOptions,
): SlateRecord {
  const slate: Slate =
    input.kind === 'founder'
      ? buildFounderSlate(input.founder)
      : buildTechnicalSlate(input.technical);
  const now = opts.now ?? (() => new Date().toISOString());
  const id = opts.id ?? randomUUID();
  let createdAt = '';

  const run = log.db.transaction((): void => {
    createdAt = now();
    log.db
      .prepare(
        `INSERT INTO decisions (id, kind, title, slate, status, created_at)
         VALUES (?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, slate.kind, slate.title, JSON.stringify(slate), createdAt);
    appendEvent(
      log,
      {
        eventType: 'decision.slate_created',
        actorId: opts.actorId,
        payload: { id, kind: slate.kind, title: slate.title },
      },
      { now: () => createdAt },
    );
  });
  run();

  return {
    id,
    status: 'open',
    slate,
    chosen: null,
    rationale: null,
    dId: null,
    decidedBy: null,
    decidedAt: null,
    createdAt,
  };
}

export interface ListSlatesFilter {
  status?: SlateStatus;
}

export function listSlates(log: EventLog, filter: ListSlatesFilter = {}): SlateRecord[] {
  const rows = filter.status
    ? log.db
        .prepare<[string], DecisionRow>(
          'SELECT * FROM decisions WHERE status = ? ORDER BY created_at DESC',
        )
        .all(filter.status)
    : log.db
        .prepare<[], DecisionRow>('SELECT * FROM decisions ORDER BY created_at DESC')
        .all();
  return rows.map(rowToSlateRecord);
}

function labelForChoice(slate: Slate, chosen: string): string {
  if (slate.kind === 'founder') {
    const option = slate.options.find((o) => o.id === chosen);
    if (!option) {
      throw new InvalidChoiceError(
        `"${chosen}" is not one of this slate's option ids (${slate.options.map((o) => o.id).join(', ')})`,
      );
    }
    return option.label;
  }
  const option = slate.options.find((o) => o.label === chosen);
  if (!option) {
    throw new InvalidChoiceError(
      `"${chosen}" is not one of this slate's option labels (${slate.options.map((o) => o.label).join(', ')})`,
    );
  }
  return option.summary;
}

function optionsConsideredText(slate: Slate): string {
  return slate.options.map((o) => o.label).join(', ');
}

export interface DecideSlateInput {
  slateId: string;
  chosen: string;
  rationale?: string;
}

export interface DecideSlateOptions {
  projectPath: string;
  actorId: string;
  now?: () => string;
}

/**
 * Non-async by design (enforced, not just convention): the whole
 * read-ledger -> compute-D-ID -> write-ledger -> write-DB-row critical
 * section must run as one synchronous JS call so a concurrent decide on a
 * different slate can never interleave mid-way and race the same ledger
 * snapshot (see `./ledger-file.js`'s doc comment). Adding an `await`
 * anywhere in this function is a correctness bug, not a style choice — the
 * type system forbids it by construction since this isn't declared `async`.
 */
export function decideSlate(
  log: EventLog,
  input: DecideSlateInput,
  opts: DecideSlateOptions,
): DecisionRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  const row = log.db
    .prepare<[string], DecisionRow>('SELECT * FROM decisions WHERE id = ?')
    .get(input.slateId);
  if (!row) throw new SlateNotFoundError(input.slateId);
  if (row.status !== 'open') throw new SlateAlreadyDecidedError(input.slateId);

  const slate = JSON.parse(row.slate) as Slate;
  const chosenLabel = labelForChoice(slate, input.chosen);

  const filePath = ledgerPath(opts.projectPath);
  const currentLedger = readLedgerSync(filePath);
  const dId = nextDecisionId(currentLedger);
  const decidedAt = now();
  const record: DecisionRecord = {
    id: dId,
    date: decidedAt.slice(0, 10),
    decision: `${slate.title}: ${chosenLabel}`,
    optionsConsidered: optionsConsideredText(slate),
    rationale: input.rationale ?? '',
  };
  const updatedLedger = appendDecisionToLedger(currentLedger, record);

  const run = log.db.transaction((): void => {
    const result = log.db
      .prepare(
        `UPDATE decisions
           SET status = 'decided', chosen = ?, rationale = ?, d_id = ?, decided_by = ?, decided_at = ?
         WHERE id = ? AND status = 'open'`,
      )
      .run(input.chosen, record.rationale, dId, opts.actorId, decidedAt, input.slateId);
    if (result.changes !== 1) {
      throw new SlateAlreadyDecidedError(input.slateId);
    }
    writeLedgerSync(filePath, updatedLedger);
    appendEvent(
      log,
      {
        eventType: 'decision.chosen',
        actorId: opts.actorId,
        payload: { id: input.slateId, dId, chosen: input.chosen },
      },
      { now: () => decidedAt },
    );
  });
  run();

  return record;
}

export function listDecisions(log: EventLog): SlateRecord[] {
  return listSlates(log, { status: 'decided' });
}
