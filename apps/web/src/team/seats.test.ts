/** W20-12: the whole roster is on the floor — seating never hides anyone. */
import { describe, expect, it } from 'vitest';
import { PERSONA_ROLES } from './roles.js';
import { DEFAULT_ZONE, seatMembers, zoneFor } from './seats.js';

const m = (role: string) => ({ role });

describe('seatMembers (W20-12)', () => {
  it('RED FIXTURE: every member ends up somewhere — the counts across zones equal the input, so no role can be silently dropped', () => {
    const members = [...PERSONA_ROLES, 'a-brand-new-specialist', 'berth-2:coding-agent'].map(m);
    const zones = seatMembers(members);
    const placed = zones.reduce((n, z) => n + z.members.length, 0);
    expect(placed).toBe(members.length);
  });

  it('an unmapped role is placed, not hidden — absence would read as "we do not have one"', () => {
    expect(zoneFor('some-future-role')).toBe(DEFAULT_ZONE);
    const zones = seatMembers([m('some-future-role')]);
    expect(zones.flatMap((z) => z.members)).toHaveLength(1);
  });

  it('a scoped actor id seats with its role', () => {
    expect(zoneFor('berth-2:challenger')).toBe(zoneFor('challenger'));
  });

  it('every persona role has an explicit seat — a new persona without one would silently land in the default', () => {
    for (const role of PERSONA_ROLES) {
      expect(zoneFor(role), `${role} has no explicit seat`).toBeTruthy();
    }
    // the verification zone must hold the members who check other people's work
    expect(zoneFor('challenger')).toBe('verification');
    expect(zoneFor('phase-gate-runner')).toBe('verification');
    // …and the chief of staff sits out front, by the founder's door (D-030)
    expect(zoneFor('chief-of-staff')).toBe('front-office');
  });

  it('empty zones do not render, and order is stable', () => {
    const zones = seatMembers([m('coding-agent'), m('challenger')]);
    expect(zones.map((z) => z.zone)).toEqual(['maker-studio', 'verification']);
  });
});
