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

import { openEventLog } from '@dokima/events';
import { resolveOpenQuestion, type BlueprintDocument } from '@dokima/pipeline';
import { createSlate, listSlates } from '../../decisions/store.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../../server/board-actor.js';
import { stateDbPath } from '../../server/board-project.js';
import type { PreflightAwaitingDecisions } from './preflight.js';
import { patchRunRecord, type PausedRun } from './paused-run.js';

export interface AwaitingDecisionsInput {
  readonly projectPath: string;
  readonly preflight: PreflightAwaitingDecisions;
  readonly blueprintTitle: string;
  readonly now: () => string;
  /** Minted by the run's POST handler, not here — W10-58 hands the id to the client before this stage can be reached. */
  readonly runId: string;
}

/**
 * 202, not 4xx. The request was well-formed, the work so far is kept, and the
 * next step belongs to a human — that is an accepted-and-pending run, not a
 * client error and not a crash. A 422 here is what made a working gate read as
 * a failure.
 */
export async function recordAwaitingDecisions(
  input: AwaitingDecisionsInput,
): Promise<AwaitingDecisionsPayload> {
  const { projectPath, preflight, blueprintTitle, now, runId } = input;
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

  // W10-58: patch the record the run already owns rather than writing a fresh
  // one, so `startedAt` and the phases already completed survive the pause.
  // The written shape is still a strict superset of `PausedRun`, which is what
  // keeps `resume.ts` reading it unchanged.
  const pausedAt = now();
  const payload: AwaitingDecisionsPayload = {
    status: 'awaiting_decisions',
    run_id: runId,
    reasons: [...preflight.reasons],
    decisions: preflight.blueprintInput.openQuestions.map((q) => ({
      key: q.key,
      slate_id: slateIdsByKey[q.key]!,
      title: q.slate.title,
    })),
  };
  await patchRunRecord(projectPath, runId, (current) => ({
    ...current,
    status: 'awaiting-decisions',
    updatedAt: pausedAt,
    blueprintTitle,
    blueprintInput: preflight.blueprintInput,
    slateIdsByKey,
    pausedAt,
    awaiting: payload,
  }));

  return payload;
}

export interface AwaitingDecisionsPayload {
  readonly status: 'awaiting_decisions';
  readonly run_id: string;
  readonly reasons: readonly string[];
  readonly decisions: readonly {
    readonly key: string;
    readonly slate_id: string;
    readonly title: string;
  }[];
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
