/**
 * Pausing a creation run on a founder decision, and resuming it (W10-67).
 *
 * The refusal is right; the disposal was the defect. `runPreflight` checks the
 * FR-P7 gate immediately after the blueprint — before any further gateway
 * spend — and when a blueprint carries unresolved founder-decision markers it
 * now returns them instead of throwing. This module turns that into durable,
 * answerable state: one open slate per question through the real decisions
 * store (event-logged, C-6), plus the blueprint input needed to pick the run
 * back up without paying for that model call twice.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { openEventLog } from '@dokima/events';
import { resolveOpenQuestion, type BlueprintDocument } from '@dokima/pipeline';
import { createSlate, listSlates } from '../../decisions/store.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../../server/board-actor.js';
import { stateDbPath } from '../../server/board-project.js';
import type { PreflightAwaitingDecisions } from './preflight.js';
import { savePausedRun, type PausedRun } from './paused-run.js';

export interface AwaitingDecisionsInput {
  readonly projectPath: string;
  readonly preflight: PreflightAwaitingDecisions;
  readonly blueprintTitle: string;
  readonly now: () => string;
}

/**
 * 202, not 4xx. The request was well-formed, the work so far is kept, and the
 * next step belongs to a human — that is an accepted-and-pending run, not a
 * client error and not a crash. A 422 here is what made a working gate read as
 * a failure.
 */
export async function replyAwaitingDecisions(
  reply: FastifyReply,
  input: AwaitingDecisionsInput,
): Promise<FastifyReply> {
  const { projectPath, preflight, blueprintTitle, now } = input;
  const runId = randomUUID();
  const slateIdsByKey: Record<string, string> = {};

  const log = openEventLog(stateDbPath(projectPath));
  try {
    ensureOperatorIdentity(log, now);
    // Only questions the gate actually complained about would be tempting to
    // create, but the blueprint's open questions ARE that set by construction —
    // an unresolved marker exists for each — and using the input keeps the
    // slate content (options, tradeoffs, the model's recommendation) rather
    // than the reason string, which is all the gate reports.
    for (const question of preflight.blueprintInput.openQuestions) {
      const record = createSlate(
        log,
        { kind: 'founder', founder: question.slate },
        { actorId: OPERATOR_ACTOR_ID, now },
      );
      slateIdsByKey[question.key] = record.id;
    }
  } finally {
    log.close();
  }

  const paused: PausedRun = {
    runId,
    blueprintTitle,
    blueprintInput: preflight.blueprintInput,
    slateIdsByKey,
    pausedAt: now(),
  };
  await savePausedRun(projectPath, paused);

  return reply.code(202).send({
    status: 'awaiting_decisions',
    run_id: runId,
    reasons: [...preflight.reasons],
    decisions: preflight.blueprintInput.openQuestions.map((q) => ({
      key: q.key,
      slate_id: slateIdsByKey[q.key],
      title: q.slate.title,
    })),
  });
}

export class UndecidedSlateError extends Error {
  constructor(public readonly keys: readonly string[]) {
    super(
      `still awaiting a decision on: ${keys.join(', ')} — answer every open slate before resuming`,
    );
    this.name = 'UndecidedSlateError';
  }
}

/**
 * Applies each answered slate to the blueprint, flipping its marker from
 * UNRESOLVED to RESOLVED and citing the D-id the ledger now holds.
 *
 * `resolveOpenQuestion` is imported, never reimplemented: it replaces the one
 * marker line and preserves every other byte, which is what keeps the gate's
 * spoofed-resolution check meaningful. A resolution this module INVENTED
 * would be exactly the self-attestation law 4 exists to prevent — the D-id
 * comes from `decideSlate`, which wrote it to `docs/DECISIONS.md` inside its
 * own synchronous critical section.
 */
export function applyDecisions(
  document: BlueprintDocument,
  paused: PausedRun,
  projectPath: string,
): BlueprintDocument {
  const log = openEventLog(stateDbPath(projectPath));
  let slates;
  try {
    slates = listSlates(log, {});
  } finally {
    log.close();
  }

  const byId = new Map(slates.map((s) => [s.id, s]));
  const undecided: string[] = [];
  let revised = document;

  for (const [key, slateId] of Object.entries(paused.slateIdsByKey)) {
    const slate = byId.get(slateId);
    if (!slate || slate.status !== 'decided' || !slate.dId) {
      undecided.push(key);
      continue;
    }
    revised = resolveOpenQuestion(revised, {
      key,
      question: slate.slate.title,
      decisionId: slate.dId,
      decisionSummary: slate.chosen ?? slate.dId,
    }).document;
  }

  if (undecided.length > 0) throw new UndecidedSlateError(undecided);
  return revised;
}
