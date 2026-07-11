import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findLaneScopeViolations, globOverlaps, writeScopesOverlap } from './lanes.js';
import type { Ticket, TicketStatus } from './types.js';

const SEGMENT = fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/);
const concretePath = fc
  .array(SEGMENT, { minLength: 1, maxLength: 5 })
  .map((s) => s.join('/'));

interface WildSpec {
  index: number;
  mode: 0 | 1 | 2;
}
const wildSpecArb: fc.Arbitrary<WildSpec> = fc.record({
  index: fc.nat(),
  mode: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
});

/**
 * Wildcard one glob out of a concrete path deterministically from `spec`
 * (fast-check-driven, so failures shrink) — independent of the overlap
 * detector under test, used as ground truth for "these must overlap".
 */
function wildcardify(pathSegments: readonly string[], spec: WildSpec): string {
  const segments = [...pathSegments];
  const i = spec.index % segments.length;
  if (spec.mode === 0) {
    // whole-segment `*`
    segments[i] = '*';
  } else if (spec.mode === 1) {
    // trailing subtree `**`
    return [...segments.slice(0, i + 1), '**'].join('/');
  } else {
    // suffix-star within the segment
    const seg = segments[i] ?? '';
    const cut = Math.max(1, Math.floor(seg.length / 2));
    segments[i] = `${seg.slice(0, cut)}*`;
  }
  return segments.join('/');
}

describe('glob-overlap detection is sound (fast-check, FR-T3)', () => {
  it('two globs independently derived from the same concrete path always overlap', () => {
    fc.assert(
      fc.property(concretePath, wildSpecArb, wildSpecArb, (path, specA, specB) => {
        const segments = path.split('/');
        const patternA = wildcardify(segments, specA);
        const patternB = wildcardify(segments, specB);
        expect(globOverlaps(patternA, patternB)).toBe(true);
        // the literal path itself always matches its own derived globs, so it must overlap both
        expect(globOverlaps(path, patternA)).toBe(true);
        expect(globOverlaps(path, patternB)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('a glob always overlaps itself (reflexive)', () => {
    fc.assert(
      fc.property(concretePath, (path) => {
        expect(globOverlaps(path, path)).toBe(true);
        expect(globOverlaps(`${path}/**`, `${path}/**`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('is symmetric for arbitrary generated glob pairs', () => {
    const globArb = fc
      .array(fc.oneof(SEGMENT, fc.constant('*'), fc.constant('**')), {
        minLength: 1,
        maxLength: 5,
      })
      .map((s) => s.join('/'));
    fc.assert(
      fc.property(globArb, globArb, (a, b) => {
        expect(globOverlaps(a, b)).toBe(globOverlaps(b, a));
      }),
      { numRuns: 200 },
    );
  });

  it('two literal paths that diverge on their first segment never overlap', () => {
    fc.assert(
      fc.property(
        SEGMENT,
        SEGMENT,
        concretePath,
        concretePath,
        (firstA, firstB, restA, restB) => {
          fc.pre(firstA !== firstB);
          expect(globOverlaps(`${firstA}/${restA}`, `${firstB}/${restB}`)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

function makeTicket(
  id: string,
  lane: string,
  writeScope: string[],
  status: TicketStatus,
): Ticket {
  return {
    id,
    type: 'task',
    title: id,
    lane,
    ownerId: status === 'ready' ? null : 'agent-1',
    status,
    interface: null,
    writeScope,
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

const ACTIVE: readonly TicketStatus[] = ['claimed', 'in_progress', 'in_review'];
const laneArb = fc.constantFrom('core', 'infra', 'ui');
const statusArb = fc.constantFrom<TicketStatus>(
  'ready',
  'claimed',
  'in_progress',
  'in_review',
  'done',
);

describe('findLaneScopeViolations matches a from-scratch reference check (fast-check, FR-T3)', () => {
  it('agrees with a naive O(n^2) re-derivation for random ticket sets sharing a path', () => {
    fc.assert(
      fc.property(
        concretePath,
        fc.array(fc.tuple(laneArb, statusArb, wildSpecArb), {
          minLength: 2,
          maxLength: 6,
        }),
        (sharedPath, specs) => {
          const segments = sharedPath.split('/');
          const tickets = specs.map(([lane, status, wildSpec], idx) =>
            makeTicket(`T-${idx}`, lane, [wildcardify(segments, wildSpec)], status),
          );
          const violations = findLaneScopeViolations(tickets);

          const expected = new Set<string>();
          for (let i = 0; i < tickets.length; i += 1) {
            for (let j = i + 1; j < tickets.length; j += 1) {
              const a = tickets[i];
              const b = tickets[j];
              if (!a || !b) continue;
              if (!writeScopesOverlap(a.writeScope, b.writeScope)) continue;
              if (a.lane === b.lane) {
                if (ACTIVE.includes(a.status) && ACTIVE.includes(b.status)) {
                  expected.add(`same:${a.id}:${b.id}`);
                }
              } else {
                expected.add(`cross:${a.id}:${b.id}`);
              }
            }
          }
          const actual = new Set(
            violations.map(
              (v) =>
                `${v.kind === 'same-lane-active-overlap' ? 'same' : 'cross'}:${v.ticketA}:${v.ticketB}`,
            ),
          );
          expect(actual).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
