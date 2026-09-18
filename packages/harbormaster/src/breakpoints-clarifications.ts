/**
 * Clarification cards: minting + reading + resolving (DATABASE.md §4
 * `clarifications`, FR-N1, UC-03, US-701). A question checkpoints ONLY the
 * ticket it names (`ticketId`); `isTicketCheckpointed` is the one query a
 * loop needs to know whether ITS ticket must pause — every other lane reads
 * straight past an open row for a different ticket, which is what "only
 * dependent work" checkpoints and "other lanes continue" means in practice
 * (no global suspend flag exists to accidentally also honor).
 *
 * Dismissal (FR-N3, US-703): `'clarification'` is an auto-eligible
 * `PauseSiteKind` (autonomy-types.ts), so a dismissal is exactly one more
 * auto-taken default — reusing `appendAutoDefaultRow` (autonomy-ledger.ts)
 * rather than a second ledger-writing path.
 */

import { appendEvent, type EventLog } from '@dokima/events';
import { listEvents } from '@dokima/events';
import { resolvePauseAction } from './autonomy.js';
import { AUTO_DEFAULTS_PER_RUN_CAP, type AutonomyMode } from './autonomy-types.js';
import { LEDGER_EVENT_TYPE } from './autonomy-ledger.js';
import { appendAutoDefaultRow } from './autonomy-ledger.js';
import type { ClarificationRecord, ClarificationStatus } from './breakpoints-types.js';

export class ClarificationNotFoundError extends Error {
  constructor(id: string) {
    super(`clarification ${id} does not exist`);
    this.name = 'ClarificationNotFoundError';
  }
}

export class ClarificationNotOpenError extends Error {
  constructor(id: string, status: ClarificationStatus, action: string) {
    super(`${action} refused: clarification ${id} is ${status}, not open`);
    this.name = 'ClarificationNotOpenError';
  }
}

interface ClarificationRow {
  id: string;
  run_id: string;
  ticket_id: string | null;
  asked_by: string;
  question: string;
  context: string | null;
  options: string | null;
  default_action: string;
  status: ClarificationStatus;
  answer: string | null;
  checkpoint_ref: string;
  created_at: string;
  resolved_at: string | null;
}

function rowToRecord(row: ClarificationRow): ClarificationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    ticketId: row.ticket_id,
    askedBy: row.asked_by,
    question: row.question,
    context: row.context === null ? null : (JSON.parse(row.context) as unknown),
    options: row.options === null ? null : (JSON.parse(row.options) as unknown),
    defaultAction: row.default_action,
    status: row.status,
    answer: row.answer,
    checkpointRef: row.checkpoint_ref,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function getClarification(
  log: EventLog,
  id: string,
): ClarificationRecord | undefined {
  const row = log.db
    .prepare<[string], ClarificationRow>('SELECT * FROM clarifications WHERE id = ?')
    .get(id);
  return row ? rowToRecord(row) : undefined;
}

export function listOpenClarifications(
  log: EventLog,
  runId?: string,
): ClarificationRecord[] {
  const rows = runId
    ? log.db
        .prepare<[string], ClarificationRow>(
          `SELECT * FROM clarifications WHERE status = 'open' AND run_id = ? ORDER BY created_at ASC`,
        )
        .all(runId)
    : log.db
        .prepare<[], ClarificationRow>(
          `SELECT * FROM clarifications WHERE status = 'open' ORDER BY created_at ASC`,
        )
        .all();
  return rows.map(rowToRecord);
}

/** True when `ticketId` has an unresolved question against it — the loop's own pause check (UC-03: "only dependent work" pauses). */
export function isTicketCheckpointed(log: EventLog, ticketId: string): boolean {
  const row = log.db
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n FROM clarifications WHERE status = 'open' AND ticket_id = ?`,
    )
    .get(ticketId);
  return (row?.n ?? 0) > 0;
}

export interface AskClarificationInput {
  readonly id: string;
  readonly runId: string;
  readonly ticketId?: string | null;
  readonly askedBy: string;
  readonly question: string;
  readonly context?: unknown;
  readonly options?: unknown;
  readonly defaultAction: string;
  /** Opaque resume point the caller can use to pick its pass back up (DATABASE.md §4). */
  readonly checkpointRef: string;
}

export interface ClarificationVerbOptions {
  now?: () => string;
  /**
   * W13-32 / D-033: the project's autonomy dial, INJECTED by the caller —
   * the mode lives in project settings, which this package cannot read.
   * Absent means interactive: the card opens and waits, as it always has.
   */
  autonomy?: { readonly mode: AutonomyMode; readonly ledgerRowId?: string };
}

/**
 * D-033's guards for taking a clarification's default unattended: the default
 * must be one of the offered options (a free-text default the agent invented
 * is what the card exists to stop), and fewer than the per-run cap must have
 * been auto-taken already (ten auto-answered questions is a ticket that
 * should have been split, and a person should see that shape). Returns why
 * the card must ask instead, or null when the default may be taken.
 */
export function whyAutoDefaultMustAsk(
  log: EventLog,
  input: Pick<AskClarificationInput, 'runId' | 'options' | 'defaultAction'>,
): string | null {
  const options = Array.isArray(input.options) ? input.options : null;
  if (!options || !options.some((o) => String(o) === input.defaultAction)) {
    return 'the default is not one of the offered options';
  }
  const taken = listEvents(log).filter((e) => {
    if (e.eventType !== LEDGER_EVENT_TYPE) return false;
    const p = e.payload as {
      pauseSite?: unknown;
      runId?: unknown;
      decision?: unknown;
    } | null;
    return (
      p?.pauseSite === 'clarification' &&
      p?.runId === input.runId &&
      p?.decision === 'auto-default'
    );
  }).length;
  if (taken >= AUTO_DEFAULTS_PER_RUN_CAP) {
    return `${taken} clarification defaults already taken unattended in this run (cap ${AUTO_DEFAULTS_PER_RUN_CAP})`;
  }
  return null;
}

/** Raises a question card (FR-N1): checkpoints only `input.ticketId`, everything else keeps going. */
export function askClarification(
  log: EventLog,
  input: AskClarificationInput,
  opts: ClarificationVerbOptions = {},
): ClarificationRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  const ticketId = input.ticketId ?? null;
  const context = input.context === undefined ? null : JSON.stringify(input.context);
  const options = input.options === undefined ? null : JSON.stringify(input.options);

  return log.db.transaction((): ClarificationRecord => {
    const createdAt = now();
    log.db
      .prepare(
        `INSERT INTO clarifications
           (id, run_id, ticket_id, asked_by, question, context, options,
            default_action, status, answer, checkpoint_ref, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.runId,
        ticketId,
        input.askedBy,
        input.question,
        context,
        options,
        input.defaultAction,
        input.checkpointRef,
        createdAt,
      );
    appendEvent(
      log,
      {
        eventType: 'clarification.asked',
        actorId: input.askedBy,
        ticketId,
        runId: input.runId,
        payload: {
          id: input.id,
          question: input.question,
          defaultAction: input.defaultAction,
          checkpointRef: input.checkpointRef,
        },
      },
      { now: () => createdAt },
    );
    /**
     * W13-32 / D-033: in `auto`, at this SAFE-LISTED site, with the guards
     * satisfied, the card is answered by its own documented default in the
     * same transaction — dismissed, ledgered as auto-default under the asking
     * identity (`decidedBy` null: no human decided), with what would have been
     * asked and the checkpoint on the row. C-5 rides inside
     * `resolvePauseAction`: a NEVER-AUTO site can never reach here.
     */
    const mode = opts.autonomy?.mode;
    const guard = mode ? whyAutoDefaultMustAsk(log, input) : 'interactive';
    if (
      mode &&
      resolvePauseAction(mode, 'clarification') === 'take_default' &&
      guard === null
    ) {
      log.db
        .prepare(
          `UPDATE clarifications SET status = 'dismissed', answer = ?, resolved_at = ? WHERE id = ?`,
        )
        .run(input.defaultAction, createdAt, input.id);
      appendEvent(
        log,
        {
          eventType: 'clarification.auto_defaulted',
          actorId: input.askedBy,
          ticketId,
          runId: input.runId,
          payload: {
            id: input.id,
            defaultTaken: input.defaultAction,
            checkpointRef: input.checkpointRef,
          },
        },
        { now: () => createdAt },
      );
      appendAutoDefaultRow(
        log,
        {
          id: opts.autonomy?.ledgerRowId ?? `${input.id}-auto-default`,
          runId: input.runId,
          pauseSite: 'clarification',
          defaultTaken: input.defaultAction,
          wouldHaveAsked: `${input.question} (checkpoint ${input.checkpointRef})`,
          actorId: input.askedBy,
        },
        { now: () => createdAt },
      );
    }
    const record = getClarification(log, input.id);
    if (!record) throw new Error(`clarification ${input.id} did not persist`);
    return record;
  })();
}

function requireOpen(log: EventLog, id: string, action: string): ClarificationRecord {
  const record = getClarification(log, id);
  if (!record) throw new ClarificationNotFoundError(id);
  if (record.status !== 'open')
    throw new ClarificationNotOpenError(id, record.status, action);
  return record;
}

export interface AnswerClarificationInput {
  readonly id: string;
  readonly answer: string;
  readonly actorId: string;
}

/** A human answers (FR-N1): "answer resumes exactly at the checkpoint" — callers read back `checkpointRef` from the returned record. */
export function answerClarification(
  log: EventLog,
  input: AnswerClarificationInput,
  opts: ClarificationVerbOptions = {},
): ClarificationRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  return log.db.transaction((): ClarificationRecord => {
    const before = requireOpen(log, input.id, 'answer');
    const resolvedAt = now();
    log.db
      .prepare(
        `UPDATE clarifications SET status = 'answered', answer = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(input.answer, resolvedAt, input.id);
    appendEvent(
      log,
      {
        eventType: 'clarification.answered',
        actorId: input.actorId,
        ticketId: before.ticketId,
        runId: before.runId,
        payload: { id: input.id, answer: input.answer },
      },
      { now: () => resolvedAt },
    );
    const record = getClarification(log, input.id);
    if (!record) throw new Error(`clarification ${input.id} vanished mid-answer`);
    return record;
  })();
}

export interface DismissClarificationInput {
  readonly id: string;
  readonly actorId: string;
  /** The ledger row id minted for this dismissal (FR-N3, US-703 AC-1). */
  readonly ledgerRowId: string;
}

/** Dismissal: documented default taken + an approvals-ledger row (FR-N3) — never a silent no-op. */
export function dismissClarification(
  log: EventLog,
  input: DismissClarificationInput,
  opts: ClarificationVerbOptions = {},
): ClarificationRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  return log.db.transaction((): ClarificationRecord => {
    const before = requireOpen(log, input.id, 'dismiss');
    const resolvedAt = now();
    log.db
      .prepare(
        `UPDATE clarifications SET status = 'dismissed', answer = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(before.defaultAction, resolvedAt, input.id);
    appendEvent(
      log,
      {
        eventType: 'clarification.dismissed',
        actorId: input.actorId,
        ticketId: before.ticketId,
        runId: before.runId,
        payload: { id: input.id, defaultTaken: before.defaultAction },
      },
      { now: () => resolvedAt },
    );
    appendAutoDefaultRow(
      log,
      {
        id: input.ledgerRowId,
        runId: before.runId,
        pauseSite: 'clarification',
        defaultTaken: before.defaultAction,
        wouldHaveAsked: before.question,
        actorId: input.actorId,
      },
      { now: () => resolvedAt },
    );
    const record = getClarification(log, input.id);
    if (!record) throw new Error(`clarification ${input.id} vanished mid-dismiss`);
    return record;
  })();
}
