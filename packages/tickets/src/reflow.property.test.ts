import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { effectiveStatus, isClaimable } from './reflow.js';
import type { Ticket, TicketStatus } from './types.js';

function ticket(id: string, status: TicketStatus, dependsOn: string[]): Ticket {
  return {
    id,
    type: 'task',
    title: id,
    lane: 'core',
    ownerId: status === 'ready' ? null : 'agent-1',
    status,
    interface: null,
    writeScope: [`packages/${id}/**`],
    dependsOn,
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    closedAt: null,
  };
}

const STATUS: readonly TicketStatus[] = [
  'ready',
  'claimed',
  'in_progress',
  'in_review',
  'done',
];
const IDS = ['T-A', 'T-B', 'T-C'] as const;

const planArb = fc.array(
  fc.record({
    id: fc.constantFrom(...IDS),
    status: fc.constantFrom(...STATUS),
    dependsOn: fc.subarray([...IDS]),
  }),
  { minLength: 1, maxLength: IDS.length },
);

describe('reflow invariants (fast-check, FR-T3)', () => {
  it('blocked <-> ready is exactly "ready status but deps not all done" — no other path produces it', () => {
    fc.assert(
      fc.property(planArb, (specs) => {
        const seen = new Set<string>();
        const tickets = specs
          .filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          })
          .map((s) =>
            ticket(
              s.id,
              s.status,
              s.dependsOn.filter((d) => d !== s.id),
            ),
          );
        const byId = new Map(tickets.map((t) => [t.id, t]));

        for (const t of tickets) {
          const depsDone = t.dependsOn.every((d) => byId.get(d)?.status === 'done');
          const status = effectiveStatus(t, byId);
          if (t.status === 'ready' && !depsDone) {
            expect(status).toBe('blocked');
          } else {
            expect(status).toBe(t.status);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('claimable implies effective status is ready and vice versa when unowned', () => {
    fc.assert(
      fc.property(planArb, (specs) => {
        const seen = new Set<string>();
        const tickets = specs
          .filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          })
          .map((s) =>
            ticket(
              s.id,
              s.status,
              s.dependsOn.filter((d) => d !== s.id),
            ),
          );
        const byId = new Map(tickets.map((t) => [t.id, t]));

        for (const t of tickets) {
          const claimable = isClaimable(t, byId);
          if (claimable) {
            expect(t.ownerId).toBeNull();
            expect(effectiveStatus(t, byId)).toBe('ready');
          }
          if (t.ownerId !== null) {
            expect(claimable).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
