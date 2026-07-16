/**
 * The six-phase topology (BLUEPRINT §3.2 table, docs/BLUEPRINT.md:173-179).
 * Validator sets for phases 2–5 are in full parity with
 * `content/validators/validate-phase-gate.sh`'s `populate_phase_artifacts`
 * (the source-of-truth phase→validator mapping, validate-phase-gate.sh:66-183)
 * — every validator that script's `phase-2`/`phase-3`/`phase-4`/`phase-5` case
 * lists unconditionally is declared here, name-for-name (`.sh` suffix
 * dropped), including validate-circular-deps, validate-module-boundaries-
 * transitive, validate-challenger-gate, and validate-spec-traceability (the
 * PLAYBOOK.md challenger/traceability gates), and phase-4's
 * validate-dead-code / validate-code-health / validate-tests-mapping /
 * validate-migrations / validate-e2e-setup / validate-ticket-hygiene /
 * validate-tracker-integrity / validate-api-consistency. Two phase-4
 * validators are deliberately NOT ported: validate-design-system.sh and
 * validate-wcag-coverage.sh, which the source script only appends when
 * `docs/design/UX_SPEC.md` exists on disk at run time (validate-phase-
 * gate.sh:150-152) — a filesystem-conditional set this static topology
 * table has no way to express (this module takes no fs dependency by
 * design, see types.ts's write_scope note); the wiring ticket that binds a
 * real filesystem check can add them conditionally at call time.
 *
 * Phases 0–1 have no validators in that source script (files only), which
 * is exactly the gap R-H3 amends: every phase here — including 0 and 1 —
 * carries `validate-mermaid` so a broken diagram can never gate-pass
 * silently on any phase, not just Design
 * (docs/work/IMPROVEMENT_RECOMMENDATIONS.md R-H3). Phases 2-5 already carry
 * `validate-mermaid` per their own source-script listing (phase-3) or via
 * this same R-H3 append (phase-2/4/5, which the source script omits it
 * from).
 *
 * `producingRole` values are content/experts ids (file name minus `.md`),
 * cross-checked against the tree under `content/experts/`; BLUEPRINT §3.2's
 * "architect, api-designer, db-architect, ux, threat-modeler" HANDOFF prose
 * uses shorthand for `architecture-designer` and `ux-engineer`.
 */
import type { Deliverable, PhaseDefinition, PhaseId } from './types.js';

export const MERMAID_VALIDATOR = 'validate-mermaid';

function deliverable(id: string, producingRole: string): Deliverable {
  return { id, producingRole };
}

export const PHASES: readonly PhaseDefinition[] = [
  {
    id: 0,
    name: 'Idea',
    deliverables: [
      deliverable('docs/VISION.md', 'pm-interviewer'),
      deliverable('docs/COMPETITIVE_ANALYSIS.md', 'researcher'),
    ],
    validators: [MERMAID_VALIDATOR],
    waiverEligible: true,
  },
  {
    id: 1,
    name: 'Plan',
    deliverables: [
      deliverable('docs/SCOPE.md', 'pm-interviewer'),
      deliverable('docs/RISKS.md', 'pm-interviewer'),
      deliverable('docs/CONSTRAINTS.md', 'pm-interviewer'),
      deliverable('docs/USER_PERSONAS.md', 'pm-interviewer'),
    ],
    validators: [MERMAID_VALIDATOR],
    waiverEligible: true,
  },
  {
    id: 2,
    name: 'Define',
    deliverables: [
      deliverable('docs/SRS.md', 'pm-interviewer'),
      deliverable('docs/USER_STORIES.md', 'pm-interviewer'),
      deliverable('docs/USE_CASES.md', 'pm-interviewer'),
      deliverable('docs/TEST_PLAN.md', 'test-engineer'),
    ],
    validators: [
      'validate-use-cases',
      'validate-user-stories',
      'validate-requirements-matrix',
      MERMAID_VALIDATOR,
    ],
    waiverEligible: true,
  },
  {
    id: 3,
    name: 'Design',
    deliverables: [
      deliverable('docs/MODULE_DESIGN.md', 'architecture-designer'),
      deliverable('docs/ARCHITECTURE.md', 'architecture-designer'),
      deliverable('docs/API_DESIGN.md', 'api-designer'),
      deliverable('docs/api/openapi.yaml', 'api-designer'),
      deliverable('docs/TECH_STACK.md', 'architecture-designer'),
      deliverable('docs/THREAT_MODEL.md', 'threat-modeler'),
      deliverable('docs/SECURITY_CONTROLS.md', 'threat-modeler'),
      deliverable('docs/INFRASTRUCTURE.md', 'architecture-designer'),
      deliverable('docs/design/UX_SPEC.md', 'ux-engineer'),
    ],
    validators: [
      'validate-module-design',
      'validate-flows',
      'validate-design-tokens',
      'validate-circular-deps',
      'validate-module-boundaries-transitive',
      'validate-infrastructure',
      'validate-observability',
      'validate-data-governance',
      'validate-resilience-patterns',
      'validate-architecture',
      'validate-api-coverage',
      'validate-sequence-coverage',
      'validate-erd-coverage',
      'validate-no-ascii-art',
      MERMAID_VALIDATOR,
      'validate-doc-render-health',
      'validate-c3-coverage',
      'validate-entry-points',
      'validate-tech-stack',
      'validate-adrs',
      'validate-security-controls',
      'validate-challenger-gate',
      'validate-tracker-integrity',
      'validate-ux-spec',
      'validate-spec-traceability',
    ],
    waiverEligible: true,
  },
  {
    id: 4,
    name: 'Build',
    deliverables: [deliverable('ticket-board', 'coding-agent')],
    validators: [
      'validate-build',
      'validate-lint',
      'validate-tests',
      'validate-tests-mapping',
      'validate-e2e-setup',
      'validate-migrations',
      'validate-iac',
      'validate-module-boundaries',
      'validate-api-consistency',
      'validate-code-health',
      'validate-dead-code',
      'validate-file-size',
      'validate-tickets',
      'validate-ticket-hygiene',
      'validate-tracker-integrity',
      'validate-challenger-gate',
      MERMAID_VALIDATOR,
    ],
    waiverEligible: false,
  },
  {
    id: 5,
    name: 'Launch',
    deliverables: [
      deliverable('fix-backlog', 'release-manager'),
      deliverable('release-notes', 'release-manager'),
    ],
    validators: [
      'validate-build',
      'validate-lint',
      'validate-tests',
      'validate-deps',
      'validate-smoke',
      'validate-fix-backlog-closed',
      'validate-challenger-gate',
      'validate-model-pins',
      'validate-code-health',
      'validate-dead-code',
      'validate-module-boundaries',
      'validate-api-consistency',
      'validate-contract-conformance',
      'validate-release-readiness',
      'validate-requirement-closure',
      MERMAID_VALIDATOR,
    ],
    waiverEligible: false,
  },
];

export class UnknownPhaseError extends Error {
  constructor(id: number) {
    super(`no such phase: ${id} (phases are 0–5)`);
    this.name = 'UnknownPhaseError';
  }
}

export function getPhase(id: PhaseId): PhaseDefinition {
  const phase = PHASES.find((p) => p.id === id);
  if (!phase) throw new UnknownPhaseError(id);
  return phase;
}

export function isLastPhase(id: PhaseId): boolean {
  return id === PHASES[PHASES.length - 1]?.id;
}

/** `null` for phase 0 (no prior phase). */
export function priorPhase(id: PhaseId): PhaseDefinition | null {
  return id === 0 ? null : getPhase(((id as number) - 1) as PhaseId);
}

/** Throws `UnknownPhaseError` when `id` is already the last phase — there is no phase 6. */
export function nextPhase(id: PhaseId): PhaseDefinition {
  return getPhase(((id as number) + 1) as PhaseId);
}
