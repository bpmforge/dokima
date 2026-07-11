import type { Ticket, TicketStatus } from './types.js';

/**
 * Overlap detector for the same glob dialect as packages/git/src/glob.ts
 * (`*` = single path segment run, `**` = zero or more full segments, `?` =
 * one non-slash char) — duplicated rather than imported because `tickets`
 * may not depend on `git` (ARCHITECTURE.md §4 dependency matrix). write_scope
 * globs are a closed, reviewed vocabulary (plan.json), not user input.
 */

/** Does any string exist that both single-segment glob fragments could match? */
function segmentTextOverlaps(a: string, b: string): boolean {
  const memo = new Map<string, boolean>();
  function rec(i: number, j: number): boolean {
    const key = `${i},${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === a.length && j === b.length) {
      result = true;
    } else if (a[i] === '*') {
      result = rec(i + 1, j) || (j < b.length && rec(i, j + 1));
    } else if (b[j] === '*') {
      result = rec(i, j + 1) || (i < a.length && rec(i + 1, j));
    } else if (i < a.length && j < b.length) {
      const ac = a[i];
      const bc = b[j];
      result = (ac === bc || ac === '?' || bc === '?') && rec(i + 1, j + 1);
    } else {
      result = false;
    }
    memo.set(key, result);
    return result;
  }
  return rec(0, 0);
}

/** Does any sequence of path segments exist that both segment-lists could match, treating `**` as zero-or-more segments? */
function segmentListOverlaps(a: readonly string[], b: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  function rec(i: number, j: number): boolean {
    const key = `${i},${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === a.length && j === b.length) {
      result = true;
    } else if (a[i] === '**') {
      result = rec(i + 1, j) || (j < b.length && rec(i, j + 1));
    } else if (b[j] === '**') {
      result = rec(i, j + 1) || (i < a.length && rec(i + 1, j));
    } else if (i < a.length && j < b.length) {
      result = segmentTextOverlaps(a[i] ?? '', b[j] ?? '') && rec(i + 1, j + 1);
    } else {
      result = false;
    }
    memo.set(key, result);
    return result;
  }
  return rec(0, 0);
}

/** True iff some file path could match both write_scope globs (FR-T3). */
export function globOverlaps(patternA: string, patternB: string): boolean {
  return segmentListOverlaps(patternA.split('/'), patternB.split('/'));
}

/** True iff any glob in `a` overlaps any glob in `b`. */
export function writeScopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((patternA) => b.some((patternB) => globOverlaps(patternA, patternB)));
}

/**
 * "Active" for lane-collision purposes: the ticket owns work in flight with
 * an open branch/diff (claimed/in_progress/in_review) — broader than the
 * WIP=1 "active ownership" check in verbs.ts, which excludes `in_review`
 * because closing (not review) is what frees the next claim. Here, an
 * in_review ticket's diff still occupies its write_scope until accepted.
 */
const ACTIVE_LANE_STATUSES: readonly TicketStatus[] = [
  'claimed',
  'in_progress',
  'in_review',
];

function isLaneActive(ticket: Ticket): boolean {
  return ACTIVE_LANE_STATUSES.includes(ticket.status);
}

export type LaneScopeViolationKind = 'same-lane-active-overlap' | 'cross-lane-overlap';

export interface LaneScopeViolation {
  kind: LaneScopeViolationKind;
  ticketA: string;
  ticketB: string;
  laneA: string;
  laneB: string;
}

/**
 * FR-T3: same-lane tickets may only have overlapping write_scope while at
 * most one of them is active; cross-lane overlap is a schema error at any
 * status (a plan-load-time check, independent of who currently owns what).
 */
export function findLaneScopeViolations(
  tickets: readonly Ticket[],
): LaneScopeViolation[] {
  const violations: LaneScopeViolation[] = [];
  for (let i = 0; i < tickets.length; i += 1) {
    for (let j = i + 1; j < tickets.length; j += 1) {
      const a = tickets[i];
      const b = tickets[j];
      if (!a || !b) continue;
      if (!writeScopesOverlap(a.writeScope, b.writeScope)) continue;
      if (a.lane === b.lane) {
        if (isLaneActive(a) && isLaneActive(b)) {
          violations.push({
            kind: 'same-lane-active-overlap',
            ticketA: a.id,
            ticketB: b.id,
            laneA: a.lane,
            laneB: b.lane,
          });
        }
      } else {
        violations.push({
          kind: 'cross-lane-overlap',
          ticketA: a.id,
          ticketB: b.id,
          laneA: a.lane,
          laneB: b.lane,
        });
      }
    }
  }
  return violations;
}

export class LaneScopeError extends Error {
  readonly violations: LaneScopeViolation[];

  constructor(violations: LaneScopeViolation[]) {
    super(
      `lane/write-scope invariant violated (FR-T3): ${violations
        .map(
          (v) =>
            `${v.kind} between ${v.ticketA} (${v.laneA}) and ${v.ticketB} (${v.laneB})`,
        )
        .join('; ')}`,
    );
    this.name = 'LaneScopeError';
    this.violations = violations;
  }
}

/** Throws LaneScopeError (schema error) if any pair of tickets violates FR-T3. */
export function validateLaneWriteScopes(tickets: readonly Ticket[]): void {
  const violations = findLaneScopeViolations(tickets);
  if (violations.length > 0) throw new LaneScopeError(violations);
}
