/**
 * The persona roles the web knows about (W20-12).
 *
 * Mirrors apps/server/src/api/personas.ts, which is itself
 * docs/design/PERSONAS.md executable. apps/web is a browser bundle and cannot
 * import from apps/server (module boundary), so this list is redeclared — and
 * the seating test asserts every entry has a seat, so a persona added on the
 * server without a seat here shows up as a failure rather than a silent
 * default placement.
 */
export const PERSONA_ROLES: readonly string[] = [
  'pm-interviewer',
  'researcher',
  'architecture-designer',
  'api-designer',
  'ux-engineer',
  'threat-modeler',
  'test-engineer',
  'coding-agent',
  'release-manager',
  'challenger',
  'phase-gate-runner',
  'chief-of-staff',
];
