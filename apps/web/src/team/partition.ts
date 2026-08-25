/**
 * The org, and everyone else (W20-14).
 *
 * The roster serves every content-pack expert — roughly sixty — while the org
 * is the twelve members with personas. Rendering all of them equally buried
 * the team under a wall of specialists that all read "nothing assigned",
 * which is the same defect W18-08 fixed on the Fleet.
 *
 * W20-12's rule still holds: nobody is hidden. So the split LEADS with the
 * org and summarises the rest by an exact count that links to the Roster —
 * the surface whose whole job is "who CAN work". The invariant that keeps
 * this honest is arithmetic: `org.length + others.length` always equals the
 * input, and the test asserts it.
 */
import type { TeamMember } from './types.js';

export interface MemberPartition<T> {
  /** Members with a persona — the org (docs/design/PERSONAS.md). */
  readonly org: readonly T[];
  /** Everyone else: real capabilities, summarised rather than listed. */
  readonly others: readonly T[];
}

export function partitionOrg<T extends TeamMember>(
  members: readonly T[],
): MemberPartition<T> {
  const org: T[] = [];
  const others: T[] = [];
  for (const m of members) {
    // A persona is exactly what makes someone a named member of the org
    // (D-028); everything else is a capability the Roster already lists.
    (m.displayName ? org : others).push(m);
  }
  return { org, others };
}

/** The one honest line that stands in for the unlisted specialists. */
export function othersSummary(count: number): string {
  if (count === 0) return '';
  return count === 1
    ? '1 other specialist is available but unassigned — see the Roster.'
    : `${String(count)} other specialists are available but unassigned — see the Roster.`;
}
