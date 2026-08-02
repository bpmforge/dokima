/**
 * Doc-path → phase-id lookup (docs/BLUEPRINT.md §3.2 table,
 * `packages/pipeline/src/phases/topology.ts`'s `PHASES`). Mirrored rather
 * than imported: `apps/web/package.json` sits outside this ticket's
 * write_scope (`apps/web/src/artifacts/**`), so a workspace dependency on
 * `@dokima/pipeline` can't be declared here (same constraint
 * `memory/dokima-narrow-write-scope-pattern.md` documents elsewhere).
 * Keep in sync with `topology.ts`'s `PHASES` if BLUEPRINT §3.2 changes.
 *
 * Populating this on the client is what feeds `phase` into
 * `POST .../artifacts/comments` (`revisionSubmission.ts`), which activates
 * `isGatedDeliverable`'s previously-dead phase branch server-side
 * (`apps/server/src/api/server/artifacts-routes/shared.ts`).
 */

const PHASE_DELIVERABLES: ReadonlyMap<string, number> = new Map([
  ['docs/VISION.md', 0],
  ['docs/COMPETITIVE_ANALYSIS.md', 0],
  ['docs/SCOPE.md', 1],
  ['docs/RISKS.md', 1],
  ['docs/CONSTRAINTS.md', 1],
  ['docs/USER_PERSONAS.md', 1],
  ['docs/SRS.md', 2],
  ['docs/USER_STORIES.md', 2],
  ['docs/USE_CASES.md', 2],
  ['docs/TEST_PLAN.md', 2],
  ['docs/MODULE_DESIGN.md', 3],
  ['docs/ARCHITECTURE.md', 3],
  ['docs/API_DESIGN.md', 3],
  ['docs/api/openapi.yaml', 3],
  ['docs/TECH_STACK.md', 3],
  ['docs/THREAT_MODEL.md', 3],
  ['docs/SECURITY_CONTROLS.md', 3],
  ['docs/INFRASTRUCTURE.md', 3],
  ['docs/design/UX_SPEC.md', 3],
]);

/** The phase-0–2 interview deliverables (this ticket's own AC1 scope). */
export const INTERVIEW_DELIVERABLE_PATHS: ReadonlySet<string> = new Set(
  [...PHASE_DELIVERABLES.entries()]
    .filter(([, phase]) => phase <= 2)
    .map(([path]) => path),
);

/** `null` for any path not a declared phase 0–3 deliverable (e.g. phase 4–5 aren't doc-shaped, or an unrecognized path). */
export function phaseForDeliverable(path: string): number | null {
  return PHASE_DELIVERABLES.get(path) ?? null;
}
