import { globOverlaps, writeScopesOverlap } from '@shipwright/shared';
import type { Ticket, TicketStatus } from './types.js';

// Re-exported for existing call sites (FR-T3); canonical implementation
// (segment DP over the write_scope glob dialect, G-20) lives in
// @shipwright/shared, which `tickets` may depend on (ARCHITECTURE.md §4).
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
