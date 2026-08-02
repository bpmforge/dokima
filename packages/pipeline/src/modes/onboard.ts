/**
 * Mode 2 — Onboard (FR-P5 AC1, BLUEPRINT §3.1, content/experts/other/
 * sdlc-onboard-mode.md Specialist Dispatch Table + Steps 1-7).
 *
 * This module is the static step topology only — which imported onboard
 * specialist produces which artifact, in what order — mirroring how
 * `phases/topology.ts` is a static phase→deliverable→role table rather than
 * an executor. It does not itself map a repo (no fs access, no gateway
 * call, no HANDOFF dispatch); a future wiring ticket binds `ONBOARD_STEPS`
 * to real specialist invocations the same way a wiring ticket would bind
 * `phases/advance.ts`'s `AdvanceDeps.verifyReceipt` seam to
 * `@dokima/events`.
 *
 * The four specialists named in FR-P5 AC1 ("landscape, entry points,
 * components, health") are the four no-skill onboard specialists from the
 * source doc's Specialist Dispatch Table: `landscape-mapper`,
 * `entry-point-tracer`, `component-mapper`, `health-coordinator` — all four
 * confirmed present under `content/experts/onboard/` (see onboard.test.ts).
 * `db-architect` (ERD, Step 3) and `sdlc-lead` (Steps 5/7, which the source
 * doc marks "Coordinator handles inline" — no specialist HANDOFF) round out
 * the full onboard sequence but are not the four AC1 names.
 */
import type { Deliverable } from '../phases/types.js';
import type { ModeDefinition, ModeStep } from './types.js';

function deliverable(id: string, producingRole: string): Deliverable {
  return { id, producingRole };
}

function step(id: string, name: string, deliverables: readonly Deliverable[]): ModeStep {
  return { id, name, deliverables };
}

/** The four onboard specialists FR-P5 AC1 names by capability. */
export const ONBOARD_SPECIALIST_ROLES = [
  'landscape-mapper',
  'entry-point-tracer',
  'component-mapper',
  'health-coordinator',
] as const;

export const ONBOARD_STEPS: readonly ModeStep[] = [
  step('landscape', 'Map the Landscape', [
    deliverable('docs/LANDSCAPE.md', 'landscape-mapper'),
  ]),
  step('entry-points', 'Trace Entry Points + Sequence Diagrams', [
    deliverable('docs/diagrams/entry-points.md', 'entry-point-tracer'),
    deliverable('docs/diagrams/sequences', 'entry-point-tracer'),
  ]),
  step('data-model', 'Map Data Model', [
    deliverable('docs/diagrams/erd.md', 'db-architect'),
  ]),
  step('components', 'Map Components', [
    deliverable('docs/diagrams/c2-containers.md', 'component-mapper'),
    deliverable('docs/diagrams/c3-components.md', 'component-mapper'),
  ]),
  step('patterns', 'Identify Patterns', [deliverable('docs/PATTERNS.md', 'sdlc-lead')]),
  step('health', 'Health Assessment', [
    deliverable('docs/HEALTH_ASSESSMENT.md', 'health-coordinator'),
    deliverable('docs/testing/USE_CASES.md', 'health-coordinator'),
    deliverable('docs/testing/TEST_PLAN.md', 'health-coordinator'),
  ]),
  step('architecture', 'Produce Final Documentation', [
    deliverable('docs/ARCHITECTURE.md', 'sdlc-lead'),
    deliverable('docs/ONBOARDING.md', 'sdlc-lead'),
    deliverable('docs/DECISION_LOG.md', 'sdlc-lead'),
  ]),
];

export const ONBOARD_MODE: ModeDefinition = {
  id: 'onboard',
  name: 'Onboard',
  macroLoopCap: 3,
  steps: ONBOARD_STEPS,
};

/** doc artifacts a Feature-mode eligibility check (`feature.ts`) treats as
 * proof the repo has been onboarded — the load-bearing subset of
 * `ONBOARD_STEPS`' deliverables, not every doc it produces. */
export const REQUIRED_ONBOARD_ARTIFACTS: readonly string[] = [
  'docs/LANDSCAPE.md',
  'docs/diagrams/entry-points.md',
  'docs/diagrams/c2-containers.md',
  'docs/HEALTH_ASSESSMENT.md',
];
