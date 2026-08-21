/**
 * The learning loop's producer (W14-05, US-602/FR-M3). Verified 2026-08-20:
 * `insertFact` had NO production caller, so `createMemoryAnchor` recalled
 * from an always-empty bank — the exact cautionary tale its own header
 * names ("an unwired memory engine recalls nothing and is worth nothing").
 *
 * Composed HERE because harbormaster may not import `memory` (ARCHITECTURE
 * §4) — the run injects `AttemptOutcomeHook`, the same seam as
 * `memoryAnchor` (W13-23).
 *
 * TRUTH DISCIPLINE (C-2): the symptom fact is inserted ALREADY VERIFIED,
 * because it is not a model's claim — it is the park reason plus the
 * gate's own captured output, both code-observed. Recall surfaces verified
 * facts only (`searchFactsBm25`), so a symptom that waited for a later
 * close to "verify" it would be invisible on exactly the retry that needs
 * it. The close appends the SOLUTION half to the same row instead
 * (`appendFactSolution`), completing the error->fix pair.
 *
 * Law 8: symptom text passes through `redactDeep` (patterns + the run's
 * exact vault values) before it touches the fact bank.
 */

import { redactDeep } from '@dokima/shared';
import {
  appendFactSolution,
  createPlaybookMemoryConsultHook,
  getCalibration,
  insertFact,
  listFacts,
  markFactVerified,
  upsertCalibration,
  type GlobalPlaybookEntryLike,
} from '@dokima/memory';
import { createCalibrationRecord, updateCalibration } from '@dokima/loop';
import type {
  AttemptOutcomeHook,
  LandAttempt,
  LandR0Consult,
} from '@dokima/harbormaster';
import {
  appendEvent,
  listGlobalPlaybook,
  openGlobalDb,
  type EventLog,
} from '@dokima/events';

const SYMPTOM_HEAD_CHARS = 500;
const SOLVED_MARKER = 'SOLVED:';

function lastAttemptOutput(attempts: readonly LandAttempt[]): string {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const output = attempts[i]!.session.output.trim();
    if (output) return output.slice(-SYMPTOM_HEAD_CHARS);
  }
  return '(the session returned no output)';
}

export interface LearningHookOptions {
  readonly log: EventLog;
  readonly secretValues: readonly string[];
  /** W15-02: the maker model, keying its calibration record (per model+role). */
  readonly makerModel?: string;
  readonly now?: () => string;
}

/** W15-02 (FR-L3): fold each attempt's self-claim-vs-gate outcome into the maker's calibration record. A manifest claiming a passing verify is a self-claim of 1; the close gate's verdict is the verified value. Attempts with no manifest made no claim and observe nothing. */
function recordCalibration(
  options: LearningHookOptions,
  attempts: readonly LandAttempt[],
  now: () => string,
): void {
  if (!options.makerModel) return;
  const phase = 'coding-agent';
  // W16-01: with the ladder live, attempts on one ticket can run DIFFERENT
  // models (attempt.sessionLabel carries which). Each attempt's observation
  // folds into the record of the model that actually made the claim —
  // charging R2's honesty to R1's record is exactly the miscalibration
  // FR-L3 exists to prevent.
  const records = new Map<string, ReturnType<typeof createCalibrationRecord>>();
  const recordFor = (model: string) => {
    const existing = records.get(model);
    if (existing) return existing;
    const loaded =
      getCalibration(options.log.db, model, phase) ??
      createCalibrationRecord({ model, phase }, now);
    records.set(model, loaded);
    return loaded;
  };
  const observed = new Set<string>();
  for (const attempt of attempts) {
    const manifest = attempt.session.manifest;
    if (!manifest) continue;
    const model = attempt.sessionLabel ?? options.makerModel;
    records.set(
      model,
      updateCalibration(
        recordFor(model),
        {
          rawConfidence: manifest.verify.exit === 0 ? 1 : 0,
          verifiedConfidence: attempt.closeGate?.ok ? 1 : 0,
        },
        now,
      ),
    );
    observed.add(model);
  }
  for (const model of observed) upsertCalibration(options.log.db, records.get(model)!);
}

export function createLearningHook(options: LearningHookOptions): AttemptOutcomeHook {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    onParked({ ticketId, reason, attempts }) {
      recordCalibration(options, attempts, now);
      const symptom = redactDeep(
        `PARKED (${reason}) after ${attempts.length} attempt(s): ` +
          lastAttemptOutput(attempts),
        options.secretValues,
      ) as string;
      const fact = insertFact(
        options.log.db,
        {
          kind: 'error_solution',
          content: symptom,
          source: 'harbormaster:park',
          confidence: 1,
          ticketId,
        },
        now,
      );
      markFactVerified(options.log.db, fact.id);
    },
    onLanded({ ticketId, commits, attempts }) {
      recordCalibration(options, attempts, now);
      const solution =
        `${SOLVED_MARKER} a later attempt landed this ticket` +
        (commits.length > 0 ? ` (commits ${commits.join(', ')})` : '');
      for (const fact of listFacts(options.log.db, {
        kind: 'error_solution',
        ticketId,
      })) {
        if (fact.content.includes(SOLVED_MARKER)) continue;
        appendFactSolution(options.log.db, fact.id, solution);
      }
    },
  };
}

/**
 * W16-03: the rung-ZERO consult, composed (BLUEPRINT §3.3 "have we solved
 * this before?", FR-M2/FR-F5). Wires the memory playbook hook into the land
 * loop's `r0Consult` seam and ledgers every consult — one
 * `playbook.r0_hit`/`playbook.r0_miss` event per ticket, the memory layer's
 * own audit trail. Global playbook entries (FR-F5: consulted for every
 * project) are read from the global DB when it exists; a missing or
 * unreadable global DB is a normal local-first state, never an error.
 */
export function createR0ConsultHook(options: {
  readonly log: EventLog;
  readonly actorId: string;
  readonly secretValues: readonly string[];
  readonly now?: () => string;
  /** Test seam — real callers read the user's global DB. */
  readonly loadGlobalEntries?: () => GlobalPlaybookEntryLike[];
}): LandR0Consult {
  let globalEntries: GlobalPlaybookEntryLike[] = [];
  try {
    if (options.loadGlobalEntries) {
      globalEntries = options.loadGlobalEntries();
    } else {
      const global = openGlobalDb();
      try {
        globalEntries = listGlobalPlaybook(global);
      } finally {
        global.close();
      }
    }
  } catch {
    // No global DB yet — honest empty set (FR-F5 degrades to local-only).
  }
  const hook = createPlaybookMemoryConsultHook(options.log.db, {
    globalEntries,
    ...(options.now ? { now: options.now } : {}),
    sink: {
      emit: (event) => {
        appendEvent(
          options.log,
          {
            eventType: event.type,
            actorId: options.actorId,
            ticketId: event.ticketId,
            payload: {
              criterion: event.criterion,
              ...(event.source ? { source: event.source } : {}),
              ...(event.findingId ? { findingId: event.findingId } : {}),
            },
          },
          { secretValues: [...options.secretValues] },
        );
      },
    },
  });
  return {
    consult: (input) => hook.consult(input),
  };
}
