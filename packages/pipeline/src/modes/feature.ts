/**
 * Mode 3 — Feature: a scoped mini-program over an already-onboarded repo
 * (FR-P5, US-106 AC-2, content/experts/other/sdlc-feature-mode.md Phase
 * Roadmap). `FEATURE_STEPS` is the same kind of static step topology as
 * `onboard.ts`'s `ONBOARD_STEPS` — no fs/gateway access here either.
 *
 * `decideFeatureEligibility` mirrors `phases/advance.ts`'s `decideAdvance`:
 * a non-throwing decision function fed evidence by the caller (DI, no fs
 * dependency taken by this package — same reasoning `phases/types.ts`
 * documents for why `AdvanceDeps` is injected rather than read from disk).
 * SRS FR-P5's acceptance sketch is literal: "Feature mode refuses on a
 * repo never onboarded" *and* the refusal names the fix, not just the gap.
 */
import { REQUIRED_ONBOARD_ARTIFACTS } from './onboard.js';
import type { Deliverable } from '../phases/types.js';
import type { ModeDefinition, ModeStep } from './types.js';

function deliverable(id: string, producingRole: string): Deliverable {
  return { id, producingRole };
}

function step(id: string, name: string, deliverables: readonly Deliverable[]): ModeStep {
  return { id, name, deliverables };
}

export const FEATURE_STEPS: readonly ModeStep[] = [
  step('impact-analysis', 'Impact Analysis', [
    deliverable('docs/explore/EXPLORE_<feature>.md', 'app-cartographer'),
  ]),
  step('design', 'Design the Feature', [
    deliverable('docs/features/<feature>/DESIGN.md', 'architecture-designer'),
  ]),
  step('implement', 'Implement', [deliverable('src/**', 'coding-agent')]),
  step('review', 'Review + Security', [
    deliverable('docs/reviews/FIX_BACKLOG_<feature>.md', 'code-reviewer'),
  ]),
  step('verify', 'Verify', [
    deliverable('docs/reviews/VERIFY_<feature>.md', 'code-reviewer'),
  ]),
  step('document', 'Document', [deliverable('docs/ARCHITECTURE.md', 'coding-agent')]),
  step('merge', 'Merge', [deliverable('pr', 'git-expert')]),
];

export const FEATURE_MODE: ModeDefinition = {
  id: 'feature',
  name: 'Feature',
  macroLoopCap: 2,
  steps: FEATURE_STEPS,
};

export interface OnboardEvidence {
  /** Doc artifact ids the caller has confirmed exist (e.g. a directory
   * listing) — this function never touches the filesystem itself. */
  readonly presentArtifacts: readonly string[];
}

export interface FeatureEligibility {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

/** Refuses Feature mode when any `REQUIRED_ONBOARD_ARTIFACTS` id is
 * missing from `evidence.presentArtifacts`, always naming the fix
 * (US-106 AC-2: "with the fix suggested"). Never throws — same style as
 * `phases/advance.ts`'s `decideAdvance`. */
export function decideFeatureEligibility(evidence: OnboardEvidence): FeatureEligibility {
  const present = new Set(evidence.presentArtifacts);
  const missing = REQUIRED_ONBOARD_ARTIFACTS.filter((id) => !present.has(id));

  if (missing.length === 0) {
    return { allowed: true, reasons: [] };
  }

  return {
    allowed: false,
    reasons: [
      `repo has not been onboarded — missing ${missing.join(', ')}`,
      'run Onboard mode first to produce these artifacts, then retry Feature mode',
    ],
  };
}
