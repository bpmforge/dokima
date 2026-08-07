/**
 * The creation run itself, executed OFF the request (W10-58).
 *
 * Split out of `index.ts` under the 400-line CODE_BOOK_PROTOCOL cap (W10-46);
 * `index.ts` keeps route registration and this file keeps the job. The move is
 * extraction only — same behaviour, same exported names.
 *
 * Everything here runs after the client already has its 202 and its run id, so
 * nothing in this file may assume a live response. Progress is reported by two
 * durable channels instead: the run record on disk (what a resume reads) and
 * hash-chained audit events (what a watcher reads).
 */
import type { FastifyRequest } from 'fastify';
import { openEventLog } from '@dokima/events';
import { runPipeline, type DecomposedPlan, type PipelinePort } from '@dokima/pipeline';
import { ensureOperatorIdentity } from '../../server/board-actor.js';
import { stateDbPath } from '../../server/board-project.js';
import {
  persistDecomposedPlan,
  type AcceptedDecomposedPlanItem,
} from '../board-lifecycle.js';
import type { RealGatewayPort } from '../gateway-model-port.js';
import { recordAwaitingDecisions } from './awaiting-decisions.js';
import { emitPhaseEvent, emitStageEvent } from './events.js';
import { readLedgerMarkdown } from './ledger.js';
import { patchRunRecord, type RunRecord } from './paused-run.js';
import { runPreflight } from './preflight.js';
import { problemForError } from './problems.js';
import type { RunPipelineRequestBody } from './request-body.js';

export interface ExecuteRunArgs {
  readonly projectPath: string;
  readonly runId: string;
  readonly body: RunPipelineRequestBody;
  readonly now: () => string;
  readonly resolvePort: (projectPath: string) => Promise<RealGatewayPort>;
  readonly request: FastifyRequest;
}

/**
 * The run, off the request. Every exit path writes a terminal record, because
 * the status route's honesty depends on it: a record stuck at `running` with a
 * dead job behind it is exactly the "no progress, no resume" opacity this
 * ticket exists to remove.
 */
export async function executeRun(args: ExecuteRunArgs): Promise<void> {
  const { projectPath, runId, body, now, resolvePort, request } = args;
  try {
    const ledgerMarkdown = await readLedgerMarkdown(projectPath);
    const modelPort = await resolvePort(projectPath);

    const preflight = await runPreflight(modelPort, body, ledgerMarkdown, {
      // Persist BEFORE emitting: the file is what a resume reads, the event is
      // what a watcher reads, and of the two only the file can cost the founder
      // another paid model call if it is missing.
      onStage: async (stage, value) => {
        const at = now();
        await patchRunRecord(projectPath, runId, (current) => ({
          ...current,
          updatedAt: at,
          phases: [...current.phases, { name: stage, at }],
          ...(stage === 'blueprint'
            ? { blueprintInput: value as RunRecord['blueprintInput'] }
            : {}),
          ...(stage === 'technical-slate' ? { technicalSlateInput: value } : {}),
          ...(stage === 'ticket-drafts' ? { ticketDrafts: value } : {}),
        }));
        withEventLog(projectPath, now, (log) => emitStageEvent(log, { runId, now }, stage));
      },
    });

    if (preflight.status === 'awaiting-decisions') {
      await recordAwaitingDecisions({
        projectPath,
        preflight,
        blueprintTitle: body.blueprintTitle,
        now,
        runId,
      });
      return;
    }

    let plan: DecomposedPlan;
    const log = openEventLog(stateDbPath(projectPath));
    try {
      ensureOperatorIdentity(log, now);
      const port: PipelinePort = {
        model: {
          blueprintInputFrom: () => preflight.blueprintInput,
          technicalSlateInputFrom: () => preflight.technicalSlateInput,
          ticketDraftsFrom: () => preflight.ticketDrafts,
        },
        emit: (event) => emitPhaseEvent(log, { runId, now }, event),
      };
      plan = runPipeline(
        {
          interviewSession: body.interviewSession,
          blueprintTitle: body.blueprintTitle,
          ledgerMarkdown,
        },
        port,
      );
    } finally {
      log.close();
    }

    const accepted = await persistDecomposedPlan(projectPath, plan, { runId, now });
    const finishedAt = now();
    await patchRunRecord(projectPath, runId, (current) => ({
      ...current,
      status: 'completed',
      updatedAt: finishedAt,
      phases: [...current.phases, { name: 'board', at: finishedAt }],
      result: {
        run_id: runId,
        plan: {
          tickets: plan.tickets,
          violations: plan.violations,
          mermaid: plan.mermaid,
        },
        plan_items: accepted.map(wireAcceptedItem),
      },
    }));
  } catch (err) {
    // A failed run keeps every stage it already paid for — that is acceptance
    // 5. `problemForError` yields the same status/detail the synchronous route
    // used to put on the response; it now lands on the record instead.
    const problem = problemForError(err, request);
    const failedAt = now();
    await patchRunRecord(projectPath, runId, (current) => ({
      ...current,
      status: 'failed',
      updatedAt: failedAt,
      // The WHOLE problem body, not a flattened message: the synchronous route
      // sent RFC7807 problem+json and callers (and tests) read its fields. A
      // background failure must not degrade that into a bare string.
      error: {
        status: problem?.status ?? 500,
        body: problem?.body ?? {
          detail: String(err instanceof Error ? err.message : err),
        },
      },
    }));
  }
}

/** Short open/close around one append: a background run must not hold the single project writer (C-6) open for minutes. */
function withEventLog(
  projectPath: string,
  now: () => string,
  fn: (log: ReturnType<typeof openEventLog>) => void,
): void {
  const log = openEventLog(stateDbPath(projectPath));
  try {
    ensureOperatorIdentity(log, now);
    fn(log);
  } finally {
    log.close();
  }
}

export function wireRunRecord(run: RunRecord) {
  return {
    run_id: run.runId,
    status: run.status,
    started_at: run.startedAt,
    updated_at: run.updatedAt,
    phases: run.phases.map((p) => ({ name: p.name, at: p.at })),
    ...(run.status === 'completed' ? { result: run.result } : {}),
    ...(run.status === 'failed' ? { error: run.error } : {}),
    ...(run.status === 'awaiting-decisions' ? { awaiting: run.awaiting } : {}),
  };
}

function wireAcceptedItem(accepted: AcceptedDecomposedPlanItem) {
  return {
    id: accepted.item.id,
    catalog_id: accepted.item.catalogId,
    state: accepted.item.state,
    ticket_id: accepted.item.ticketId,
    ticket_created: accepted.ticketCreated,
  };
}
