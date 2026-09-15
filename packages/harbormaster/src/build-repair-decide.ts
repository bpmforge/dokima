/**
 * The repair decision (W23-11, AB-11) — the chapter of `build-repair-loop.ts`
 * that decides whether to open another round, split out under the 400-line
 * CODE_BOOK_PROTOCOL cap. Re-exported by name from the loop, never with
 * `export *`: W23-21 records that validate-exports does not follow a star
 * re-export, so a chapter reached that way vanishes from the ratchet.
 */

import { groupByOwner, type RepairBatch, type RepairFinding } from './repair-findings.js';
import type { RepairRoundRecord } from './build-repair-loop.js';

export type RepairStopKind =
  | 'confirmed'
  /** Nothing to review: the ticket parked, or a person already disposed of it. */
  | 'not-reviewed'
  | 'exhausted'
  | 'no-progress'
  | 'infrastructure'
  | 'scope-conflict'
  | 'stopped';

export type RepairAction =
  | { readonly kind: 'repair'; readonly round: number }
  | { readonly kind: 'stop'; readonly stop: RepairStopKind; readonly reason: string };

export interface RepairFacts {
  readonly ticketId: string;
  /** The review's own verdict on whether this may be accepted without a person. */
  readonly eligible: boolean;
  /** Why not, in the review's words. The repairable statement when nothing structured was attributable. */
  readonly blockers: readonly string[];
  /** Checks that could not answer — a missing scanner, a dead endpoint, an errored run. */
  readonly infrastructure: readonly string[];
  readonly sourceDigest: string | null;
  readonly batch: RepairBatch;
  readonly rounds: readonly RepairRoundRecord[];
  readonly maxRounds: number;
}

/**
 * The signature two attempts are compared on. Finding identities when the
 * origins gave enough to have any, and the blocker sentences otherwise —
 * because the no-progress rule must stay alive on the path where a verdict
 * names no file, which is most of them today.
 */
export function attemptSignature(facts: {
  readonly findings: readonly RepairFinding[];
  readonly blockers: readonly string[];
}): readonly string[] {
  const ids = facts.findings.map((f) => f.id);
  return [...(ids.length > 0 ? ids : facts.blockers)].sort();
}

function sameSignature(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * Whether to open another repair round. ORDER IS THE CONTRACT, and it is
 * fail-closed: every reason to stop is asked before the reason to spend.
 */
export function decideRepairAction(facts: RepairFacts): RepairAction {
  if (facts.eligible) {
    return { kind: 'stop', stop: 'confirmed', reason: 'the review confirmed this work' };
  }
  if (facts.infrastructure.length > 0) {
    return {
      kind: 'stop',
      stop: 'infrastructure',
      reason:
        `a check could not answer (${facts.infrastructure.join(', ')}) — that is not ` +
        `the code being wrong, and a repair round against it would send a maker ` +
        `after a defect nobody has evidence of`,
    };
  }
  if (facts.batch.findings.length === 0 && facts.batch.outOfScope.length > 0) {
    return {
      kind: 'stop',
      stop: 'scope-conflict',
      reason:
        `every remaining finding is outside this ticket's approved write scope ` +
        `(${facts.batch.outOfScope.length}) — they are proposals for a person, and ` +
        `a repair round must never grant itself the file`,
    };
  }
  if (facts.batch.findings.length === 0 && facts.blockers.length === 0) {
    return {
      kind: 'stop',
      stop: 'no-progress',
      reason: 'the review is not eligible and named nothing that could be repaired',
    };
  }
  if (facts.rounds.length >= facts.maxRounds) {
    return {
      kind: 'stop',
      stop: 'exhausted',
      reason:
        `${facts.rounds.length} automatic repair round(s) have already been spent on ` +
        `this ticket, which is the bound — a restart does not refill it`,
    };
  }
  const signature = attemptSignature({
    findings: facts.batch.findings,
    blockers: facts.blockers,
  });
  const last = facts.rounds[facts.rounds.length - 1];
  if (
    last &&
    last.sourceDigest === facts.sourceDigest &&
    sameSignature(last.signature, signature)
  ) {
    return {
      kind: 'stop',
      stop: 'no-progress',
      reason:
        `the previous repair round changed neither the source nor what is wrong ` +
        `with it — two attempts producing the same unresolved findings over the ` +
        `same tree are not converging`,
    };
  }
  return { kind: 'repair', round: facts.rounds.length + 1 };
}

/**
 * The rejection reason the next maker attempt will read, built from the batch
 * that OWNS this ticket. It reaches the maker through the path W21-42 already
 * built: `latestRejectionReason` is consulted at rung zero and outranks a
 * playbook hit, so nothing new has to be threaded through the handoff.
 */
export function repairReason(
  ticketId: string,
  batch: RepairBatch,
  blockers: readonly string[],
): string {
  const mine = groupByOwner(batch).get(ticketId) ?? [];
  const lines = mine.map(
    (f) =>
      `- [${f.severity}] ${f.ruleId} at ${f.path}:${f.location} — ${f.title}` +
      (f.confidenceKind === 'review-hypothesis' ? ' (unconfirmed hypothesis)' : ''),
  );
  const parked =
    batch.outOfScope.length > 0
      ? [
          `Outside this ticket's write scope, so NOT yours to change and left as ` +
            `proposals: ${batch.outOfScope.map((f) => f.path).join(', ')}.`,
        ]
      : [];
  return [
    `The machine review sent this back. What is unresolved:`,
    ...blockers.map((b) => `- ${b}`),
    ...lines,
    ...parked,
  ].join('\n');
}
