/**
 * Run lifecycle: minting + reading (DATABASE.md §3 `runs`, FR-H3/FR-C7).
 * Every transition writes the `runs` row and appends its anchoring
 * `run.*` event in the same `db.transaction()` — same discipline
 * `mintReceipt` uses for `receipts` (packages/events/src/receipts.ts): the
 * row is the fast-queryable current state, the event is the durable audit
 * trail neither can drift from the other.
 */

import { appendEvent, type EventLog } from '@shipwright/events';
import type {
  BreakpointMode,
  RunMode,
  RunRecord,
  RunStatus,
} from './breakpoints-types.js';

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run ${runId} does not exist`);
    this.name = 'RunNotFoundError';
  }
}

export class InvalidRunTransitionError extends Error {
  constructor(runId: string, from: RunStatus, action: string) {
    super(`${action} refused: run ${runId} is ${from}`);
    this.name = 'InvalidRunTransitionError';
  }
}

interface RunRow {
  id: string;
  project_id: string;
  mode: RunMode;
  phase: number | null;
  status: RunStatus;
  breakpoint: BreakpointMode;
  berths: number;
  budget_usd: number | null;
  budget_tokens: number | null;
  started_at: string;
  ended_at: string | null;
}

function rowToRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode,
    phase: row.phase,
    status: row.status,
    breakpoint: row.breakpoint,
    berths: row.berths,
    budgetUsd: row.budget_usd,
    budgetTokens: row.budget_tokens,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function getRun(log: EventLog, runId: string): RunRecord | undefined {
  const row = log.db
    .prepare<[string], RunRow>('SELECT * FROM runs WHERE id = ?')
    .get(runId);
  return row ? rowToRecord(row) : undefined;
}

export function listRuns(log: EventLog, projectId?: string): RunRecord[] {
  const rows = projectId
    ? log.db
        .prepare<[string], RunRow>(
          'SELECT * FROM runs WHERE project_id = ? ORDER BY started_at ASC',
        )
        .all(projectId)
    : log.db.prepare<[], RunRow>('SELECT * FROM runs ORDER BY started_at ASC').all();
  return rows.map(rowToRecord);
}

export interface CreateRunInput {
  readonly id: string;
  readonly projectId: string;
  readonly mode: RunMode;
  readonly phase?: number | null;
  readonly breakpoint: BreakpointMode;
  readonly berths?: number;
  readonly budgetUsd?: number | null;
  readonly budgetTokens?: number | null;
  /** Identity starting the run (FR-C7: CLI and API drive this same verb). */
  readonly actorId: string;
}

export interface RunVerbOptions {
  now?: () => string;
}

/** The one place a run comes into existence (API_DESIGN.md `POST /projects/{id}/runs`). */
export function createRun(
  log: EventLog,
  input: CreateRunInput,
  opts: RunVerbOptions = {},
): RunRecord {
  if (getRun(log, input.id)) {
    throw new Error(`run ${input.id} already exists`);
  }
  const now = opts.now ?? (() => new Date().toISOString());
  const berths = input.berths ?? 1;
  const phase = input.phase ?? null;
  const budgetUsd = input.budgetUsd ?? null;
  const budgetTokens = input.budgetTokens ?? null;

  const run = log.db.transaction((): RunRecord => {
    const startedAt = now();
    log.db
      .prepare(
        `INSERT INTO runs
           (id, project_id, mode, phase, status, breakpoint, berths, budget_usd,
            budget_tokens, started_at, ended_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.projectId,
        input.mode,
        phase,
        input.breakpoint,
        berths,
        budgetUsd,
        budgetTokens,
        startedAt,
      );
    appendEvent(
      log,
      {
        eventType: 'run.created',
        actorId: input.actorId,
        runId: input.id,
        payload: {
          projectId: input.projectId,
          mode: input.mode,
          phase,
          breakpoint: input.breakpoint,
          berths,
          budgetUsd,
          budgetTokens,
        },
      },
      { now: () => startedAt },
    );
    return {
      id: input.id,
      projectId: input.projectId,
      mode: input.mode,
      phase,
      status: 'running',
      breakpoint: input.breakpoint,
      berths,
      budgetUsd,
      budgetTokens,
      startedAt,
      endedAt: null,
    };
  });
  return run();
}

function requireRun(log: EventLog, runId: string): RunRecord {
  const run = getRun(log, runId);
  if (!run) throw new RunNotFoundError(runId);
  return run;
}

function transitionStatus(
  log: EventLog,
  runId: string,
  eventType: string,
  actorId: string,
  fromStatuses: readonly RunStatus[],
  toStatus: RunStatus,
  action: string,
  setEndedAt: boolean,
  opts: RunVerbOptions,
): RunRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  return log.db.transaction((): RunRecord => {
    const run = requireRun(log, runId);
    if (!fromStatuses.includes(run.status)) {
      throw new InvalidRunTransitionError(runId, run.status, action);
    }
    const at = now();
    if (setEndedAt) {
      log.db
        .prepare('UPDATE runs SET status = ?, ended_at = ? WHERE id = ?')
        .run(toStatus, at, runId);
    } else {
      log.db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(toStatus, runId);
    }
    appendEvent(log, { eventType, actorId, runId, payload: {} }, { now: () => at });
    return requireRun(log, runId);
  })();
}

/** Global pause (FR-H3): "finishes current ticket, checkpoints, stops" happens at the loop level (StopSwitch); this records the run's own state. */
export function pauseRun(
  log: EventLog,
  runId: string,
  actorId: string,
  opts: RunVerbOptions = {},
): RunRecord {
  return transitionStatus(
    log,
    runId,
    'run.paused',
    actorId,
    ['running'],
    'paused',
    'pause',
    false,
    opts,
  );
}

/** Marks a run running again after `resumeProject` (resume.ts) has cleared drift, or after an operator answers a clarification. */
export function markRunResumed(
  log: EventLog,
  runId: string,
  actorId: string,
  opts: RunVerbOptions = {},
): RunRecord {
  return transitionStatus(
    log,
    runId,
    'run.resumed',
    actorId,
    ['paused', 'suspended'],
    'running',
    'resume',
    false,
    opts,
  );
}

/** A resume that refused on drift (resume.ts) — the run stays parked for a human, distinct from an ordinary pause. */
export function suspendRun(
  log: EventLog,
  runId: string,
  actorId: string,
  opts: RunVerbOptions = {},
): RunRecord {
  return transitionStatus(
    log,
    runId,
    'run.suspended',
    actorId,
    ['running', 'paused'],
    'suspended',
    'suspend',
    false,
    opts,
  );
}

export function stopRun(
  log: EventLog,
  runId: string,
  actorId: string,
  opts: RunVerbOptions = {},
): RunRecord {
  return transitionStatus(
    log,
    runId,
    'run.stopped',
    actorId,
    ['running', 'paused', 'suspended'],
    'stopped',
    'stop',
    true,
    opts,
  );
}

export function completeRun(
  log: EventLog,
  runId: string,
  actorId: string,
  opts: RunVerbOptions = {},
): RunRecord {
  return transitionStatus(
    log,
    runId,
    'run.completed',
    actorId,
    ['running', 'paused'],
    'done',
    'complete',
    true,
    opts,
  );
}
