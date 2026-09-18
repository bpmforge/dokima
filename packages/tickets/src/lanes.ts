import { globOverlaps, writeScopesOverlap } from '@dokima/shared';
import type { Ticket, TicketStatus } from './types.js';

// Re-exported for existing call sites (FR-T3); canonical implementation
// (segment DP over the write_scope glob dialect, G-20) lives in
// @dokima/shared, which `tickets` may depend on (ARCHITECTURE.md §4).
export { globOverlaps, writeScopesOverlap };

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

/**
 * W23-31 (D-015): a finished ticket has RELEASED its territory. Its
 * write_scope is history, not a claim, so it takes part in no overlap check —
 * a new ticket in another lane may own a file a done ticket once wrote.
 * Live (Vault, 2026-09-18): the board-level fix W23-30 asks for ("correct
 * the script where it lives") could not be filed in its natural lane because
 * the scaffold ticket that wrote package.json, done for three weeks, still
 * counted. validate-plan applies the same release to Dokima's own board (P8).
 */
const RELEASED_STATUSES: readonly TicketStatus[] = ['done', 'waived'];
function hasReleasedTerritory(ticket: Ticket): boolean {
  return RELEASED_STATUSES.includes(ticket.status);
}

export type LaneScopeViolationKind = 'same-lane-active-overlap' | 'cross-lane-overlap';

export interface LaneScopeViolation {
  kind: LaneScopeViolationKind;
  ticketA: string;
  ticketB: string;
  laneA: string;
  laneB: string;
  /** W23-31: the statuses that were COUNTED, so a refusal explains itself. */
  statusA: TicketStatus;
  statusB: TicketStatus;
}

/**
 * FR-T3: same-lane tickets may only have overlapping write_scope while at
 * most one of them is active; cross-lane overlap is a schema error among
 * tickets that can still write (a plan-load-time check, independent of who
 * currently owns what). Done and waived tickets are out of both checks
 * (W23-31, D-015).
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
      if (hasReleasedTerritory(a) || hasReleasedTerritory(b)) continue;
      if (!writeScopesOverlap(a.writeScope, b.writeScope)) continue;
      if (a.lane === b.lane) {
        if (isLaneActive(a) && isLaneActive(b)) {
          violations.push({
            kind: 'same-lane-active-overlap',
            ticketA: a.id,
            ticketB: b.id,
            laneA: a.lane,
            laneB: b.lane,
            statusA: a.status,
            statusB: b.status,
          });
        }
      } else {
        violations.push({
          kind: 'cross-lane-overlap',
          ticketA: a.id,
          ticketB: b.id,
          laneA: a.lane,
          laneB: b.lane,
          statusA: a.status,
          statusB: b.status,
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
            `${v.kind} between ${v.ticketA} (${v.laneA}, ${v.statusA}) and ${v.ticketB} (${v.laneB}, ${v.statusB})`,
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
