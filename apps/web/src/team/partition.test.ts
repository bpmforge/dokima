/** W20-14: lead with the org, summarise the rest — and never drop anyone. */
import { describe, expect, it } from 'vitest';
import { othersSummary, partitionOrg } from './partition.js';
import type { TeamMember } from './types.js';

const persona = (id: string): TeamMember => ({
  actorId: id,
  role: id,
  displayName: id.toUpperCase(),
  jobLine: 'does a thing',
});
const bare = (id: string): TeamMember => ({ actorId: id, role: id });

describe('partitionOrg (W20-14)', () => {
  it('RED FIXTURE: org + others always equals the whole roster — the split summarises, it never drops (W20-12)', () => {
    const members = [
      ...['sam', 'blue', 'wiggum'].map(persona),
      ...Array.from({ length: 48 }, (_, i) => bare(`specialist-${i}`)),
    ];
    const { org, others } = partitionOrg(members);
    expect(org.length + others.length).toBe(members.length);
    expect(org).toHaveLength(3);
    expect(others).toHaveLength(48);
  });

  it('a persona is what makes someone part of the org; a bare capability is not', () => {
    const { org, others } = partitionOrg([persona('sam'), bare('anti-slop-auditor')]);
    expect(org[0]!.actorId).toBe('sam');
    expect(others[0]!.actorId).toBe('anti-slop-auditor');
  });

  it('the summary states an EXACT count and points at the surface that lists them', () => {
    expect(othersSummary(48)).toBe(
      '48 other specialists are available but unassigned — see the Roster.',
    );
    expect(othersSummary(1)).toContain('1 other specialist is');
    expect(othersSummary(0)).toBe('');
  });
});
