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
  insertFact,
  listFacts,
  markFactVerified,
} from '@dokima/memory';
import type { AttemptOutcomeHook, LandAttempt } from '@dokima/harbormaster';
import type { EventLog } from '@dokima/events';

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
  readonly now?: () => string;
}

export function createLearningHook(options: LearningHookOptions): AttemptOutcomeHook {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    onParked({ ticketId, reason, attempts }) {
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
    onLanded({ ticketId, commits }) {
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
