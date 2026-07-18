import { describe, expect, it } from 'vitest';
import { writeScopesOverlap, type Ticket, type TicketStatus } from '@shipwright/tickets';
import { pickNextBerthTicket } from '../src/berths-scheduler.js';
import { forEachSeed, randInt } from './berths-test-helpers.js';

const LANES = ['core', 'infra', 'ui', 'docs'] as const;

interface SimTicket {
  id: string;
  lane: string;
  writeScope: string[];
}

/**
 * A fixture board that already satisfies D-015/FR-T3's plan-load-time
 * schema invariant by construction: every ticket's write_scope is
 * namespaced under its own lane, so cross-lane overlap is structurally
 * impossible and same-lane overlap is irrelevant (this scheduler already
 * guarantees at most one same-lane ticket is ever active). That isolates
 * this property test to what's actually new here — the N-berth scheduling
 * invariant — rather than re-proving glob-overlap detection, which
 * `packages/tickets/src/lanes.property.test.ts` already covers.
 */
function randomBoard(rng: () => number): SimTicket[] {
  const size = randInt(rng, 3, 14);
  return Array.from({ length: size }, (_, i) => {
    const lane = LANES[randInt(rng, 0, LANES.length - 1)]!;
    return { id: `T-${i}`, lane, writeScope: [`lanes/${lane}/${i}/**`] };
  });
}

function toTicket(sim: SimTicket, status: TicketStatus, ownerId: string | null): Ticket {
  return {
    id: sim.id,
    type: 'task',
    title: sim.id,
    lane: sim.lane,
    ownerId,
    status,
    interface: null,
    writeScope: sim.writeScope,
    dependsOn: [],
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    closedAt: null,
  };
}

interface SimulationResult {
  laneCollision: boolean;
  writeScopeCollision: boolean;
}

/**
 * Discrete-tick simulation of `berthCount` concurrent berths repeatedly
 * calling the REAL `pickNextBerthTicket` against a mutated ticket
 * snapshot. A picked ticket goes straight to `in_review` (still lane-busy
 * per FR-T3) and frees after a randomized review delay, modeling landing
 * happening well before a human clears the review queue. At every tick
 * this asserts no two simultaneously-active tickets share a lane or an
 * overlapping write_scope — the acceptance-2 property.
 */
function simulate(
  rng: () => number,
  board: readonly SimTicket[],
  berthCount: number,
): SimulationResult {
  let tickets: Ticket[] = board.map((sim) => toTicket(sim, 'ready', null));
  const skipPerBerth: Set<string>[] = Array.from({ length: berthCount }, () => new Set());
  const freeAt = new Map<string, number>();
  let laneCollision = false;
  let writeScopeCollision = false;

  const maxTicks = board.length * 3 + 10;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    for (const [id, at] of [...freeAt.entries()]) {
      if (at <= tick) {
        tickets = tickets.map((t) =>
          t.id === id ? { ...t, status: 'done', ownerId: null } : t,
        );
        freeAt.delete(id);
      }
    }

    for (let berth = 0; berth < berthCount; berth += 1) {
      const next = pickNextBerthTicket(tickets, skipPerBerth[berth]!);
      if (!next) continue;
      skipPerBerth[berth]!.add(next.id);
      tickets = tickets.map((t) =>
        t.id === next.id ? { ...t, status: 'in_review', ownerId: `berth-${berth}` } : t,
      );
      const delay = randInt(rng, 0, 5);
      freeAt.set(next.id, tick + 1 + delay);
    }

    const active = tickets.filter(
      (t) => t.status === 'in_progress' || t.status === 'in_review',
    );
    const laneOf = new Map<string, string>();
    for (const t of active) {
      const prior = laneOf.get(t.lane);
      if (prior && prior !== t.id) laneCollision = true;
      laneOf.set(t.lane, t.id);
    }
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i]!;
        const b = active[j]!;
        if (a.id !== b.id && writeScopesOverlap(a.writeScope, b.writeScope)) {
          writeScopeCollision = true;
        }
      }
    }
  }

  return { laneCollision, writeScopeCollision };
}

describe('N berths over a fixture board never produce overlapping write-scope edits (D-010, FR-H5, acceptance 2)', () => {
  it('holds for randomized boards, berth counts, and review-delay interleavings', () => {
    forEachSeed(300, (rng) => {
      const board = randomBoard(rng);
      const berthCount = randInt(rng, 1, 5);
      const result = simulate(rng, board, berthCount);
      expect(result.laneCollision).toBe(false);
      expect(result.writeScopeCollision).toBe(false);
    });
  });

  it('every ticket is eventually processed regardless of berth count (no starvation)', () => {
    forEachSeed(200, (rng) => {
      const board = randomBoard(rng);
      const berthCount = randInt(rng, 1, 5);
      let tickets: Ticket[] = board.map((sim) => toTicket(sim, 'ready', null));
      const skipPerBerth: Set<string>[] = Array.from(
        { length: berthCount },
        () => new Set(),
      );
      const doneIds = new Set<string>();
      for (let tick = 0; tick < board.length * 3 + 10; tick += 1) {
        for (let berth = 0; berth < berthCount; berth += 1) {
          const next = pickNextBerthTicket(tickets, skipPerBerth[berth]!);
          if (!next) continue;
          skipPerBerth[berth]!.add(next.id);
          doneIds.add(next.id);
          tickets = tickets.map((t) =>
            t.id === next.id ? { ...t, status: 'done', ownerId: null } : t,
          );
        }
      }
      expect(doneIds.size).toBe(board.length);
    });
  });
});
