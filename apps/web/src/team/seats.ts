/**
 * Where each member sits (W20-12, docs/design/PERSONAS.md).
 *
 * The mock showed a sample; the product shows the org. Two rules:
 *
 *  1. **Nobody is hidden.** Seats are derived from role, and any role without
 *     a mapping falls into the general floor rather than being dropped — an
 *     absent member reads as "we don't have one", which would be a lie
 *     (D-028's fallback rule, applied to placement rather than naming).
 *  2. **Seat is a ZONE, not a state.** Where someone sits says what they are
 *     for; what they are doing comes from `deriveMemberState`. The break room
 *     is where an idle member is drawn, but "idle" is still an event-derived
 *     conclusion, never a consequence of the seating chart.
 */
export type Zone = 'maker-studio' | 'design-bay' | 'verification' | 'front-office';

export const ZONE_LABEL: Record<Zone, string> = {
  'maker-studio': 'Maker studio',
  'design-bay': 'Design bay',
  verification: 'Verification',
  'front-office': 'Front office',
};

/** Role -> zone. Roles absent here still appear, on the general floor. */
const SEATING: Record<string, Zone> = {
  'coding-agent': 'maker-studio',
  'test-engineer': 'maker-studio',
  'api-designer': 'maker-studio',
  'architecture-designer': 'design-bay',
  'ux-engineer': 'design-bay',
  researcher: 'design-bay',
  challenger: 'verification',
  'phase-gate-runner': 'verification',
  'threat-modeler': 'verification',
  'pm-interviewer': 'front-office',
  'release-manager': 'front-office',
  'chief-of-staff': 'front-office',
};

/** The zone an unmapped role lands in — present, never dropped. */
export const DEFAULT_ZONE: Zone = 'maker-studio';

export function zoneFor(role: string): Zone {
  const tail = role.slice(role.lastIndexOf(':') + 1);
  return SEATING[role] ?? SEATING[tail] ?? DEFAULT_ZONE;
}

export interface ZonedMembers<T> {
  readonly zone: Zone;
  readonly label: string;
  readonly members: readonly T[];
}

/**
 * Group members by zone, preserving input order within each. Every zone with
 * at least one member appears; the total across zones always equals the input
 * length, which is the property that makes "nobody is hidden" checkable.
 */
export function seatMembers<T extends { readonly role: string }>(
  members: readonly T[],
): ZonedMembers<T>[] {
  const order: Zone[] = ['maker-studio', 'design-bay', 'verification', 'front-office'];
  const buckets = new Map<Zone, T[]>();
  for (const m of members) {
    const zone = zoneFor(m.role);
    const list = buckets.get(zone);
    if (list) list.push(m);
    else buckets.set(zone, [m]);
  }
  return order
    .filter((z) => (buckets.get(z)?.length ?? 0) > 0)
    .map((zone) => ({
      zone,
      label: ZONE_LABEL[zone],
      members: buckets.get(zone)!,
    }));
}
