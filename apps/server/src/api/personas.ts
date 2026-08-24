/**
 * Personas — the org's faces (W20-01, D-028).
 *
 * PRESENTATION OVER REAL ACTOR IDS, NEVER IDENTITY. Every event, receipt and
 * trace keeps the real actor id; this module only supplies a display name, an
 * avatar key and a human job line for surfaces that would otherwise render a
 * role slug. Two rules fall out of D-028 and are enforced by the tests:
 *
 *  1. An actor id with no persona row resolves to `null` — the caller renders
 *     the raw id. A fabricated person is worse than a slug.
 *  2. Nothing here may assert a STATE. A persona says who someone is, never
 *     what they are doing; state comes from the ledger (UX_SPEC §10).
 *
 * Names are role-flavored (founder choice 2026-08-24) so a card is
 * self-explaining without its subtitle. The roster lives in
 * docs/design/PERSONAS.md; this file is that table, executable.
 */

export interface Persona {
  /** The real roster/actor id this face belongs to — never replaced by it. */
  readonly role: string;
  readonly displayName: string;
  /** Stable key; the web renders an emoji today, a sprite under W20-08. */
  readonly avatarKey: string;
  /** One human sentence: what this member is for, in the founder's words. */
  readonly jobLine: string;
}

/** docs/design/PERSONAS.md, in code. Order is the roster's reading order. */
export const PERSONAS: readonly Persona[] = [
  {
    role: 'pm-interviewer',
    displayName: 'Ida',
    avatarKey: 'ida-interviewer',
    jobLine: 'Asks you the questions that turn an idea into a plan.',
  },
  {
    role: 'researcher',
    displayName: 'Scout',
    avatarKey: 'scout-researcher',
    jobLine: "Digs up what's already known before anyone builds.",
  },
  {
    role: 'architecture-designer',
    displayName: 'Blue',
    avatarKey: 'blue-architect',
    jobLine: 'Draws the blueprints — how the pieces fit before they exist.',
  },
  {
    role: 'api-designer',
    displayName: 'Dex',
    avatarKey: 'dex-api',
    jobLine: 'Designs the contracts the pieces talk through.',
  },
  {
    role: 'ux-engineer',
    displayName: 'Sketch',
    avatarKey: 'sketch-ux',
    jobLine: "Shapes what you'll actually see and touch.",
  },
  {
    role: 'threat-modeler',
    displayName: 'Locke',
    avatarKey: 'locke-security',
    jobLine: 'Asks "how could this go wrong?" before it can.',
  },
  {
    role: 'test-engineer',
    displayName: 'Tess',
    avatarKey: 'tess-tests',
    jobLine: 'Writes the checks that prove the work does what it claims.',
  },
  {
    role: 'coding-agent',
    displayName: 'Sam',
    avatarKey: 'sam-builder',
    jobLine: 'Builds the tickets — the hands on the keyboard.',
  },
  {
    role: 'release-manager',
    displayName: 'Shipp',
    avatarKey: 'shipp-release',
    jobLine: 'Gets finished work out the door, notes and all.',
  },
  {
    role: 'challenger',
    displayName: 'Wiggum',
    avatarKey: 'wiggum-challenger',
    jobLine: 'Tries to break every claim before you have to trust it.',
  },
  {
    role: 'phase-gate-runner',
    displayName: 'Vera',
    avatarKey: 'vera-verifier',
    jobLine: 'Runs the gates and mints the receipts — nobody grades their own homework.',
  },
  {
    // D-030: never does product work; owns the funnel to the founder.
    role: 'chief-of-staff',
    displayName: 'Otto',
    avatarKey: 'otto-chief',
    jobLine:
      "Never does the work — decides what's worth your attention, and in what order.",
  },
];

const BY_ROLE = new Map(PERSONAS.map((p) => [p.role, p]));

/**
 * The persona for a roster role or an actor id, or `null` when none exists.
 *
 * Agent actor ids carry a scope prefix on the real path (`agent:coding-agent`,
 * `berth-2:coding-agent`), so the segment after the last `:` is matched too —
 * but ONLY as a lookup. The id itself is never rewritten (D-028).
 */
export function personaFor(actorOrRole: string | null | undefined): Persona | null {
  if (!actorOrRole) return null;
  const direct = BY_ROLE.get(actorOrRole);
  if (direct) return direct;
  const tail = actorOrRole.slice(actorOrRole.lastIndexOf(':') + 1);
  return BY_ROLE.get(tail) ?? null;
}

/**
 * What a surface should print for an actor: the persona's name when one
 * exists, the raw id when it does not. The fallback is the honest half of
 * D-028 — an unknown machine identity is shown as itself, never invented.
 */
export function displayNameFor(actorOrRole: string): string {
  return personaFor(actorOrRole)?.displayName ?? actorOrRole;
}

/** Wire shape for the roster route — snake_case like the rest of the API. */
export function wirePersona(p: Persona) {
  return { display_name: p.displayName, avatar_key: p.avatarKey, job_line: p.jobLine };
}
