/**
 * Mode 4 — Improve: audit + fix backlog produced as tickets (FR-P5,
 * content/experts/other/sdlc-improve-mode.md Step 2 "Run Audits" / Step 3
 * "Synthesize Findings into Improvement Backlog"). Unlike `onboard.ts`/
 * `feature.ts` (static step topologies only), this module owns one real
 * deterministic transform: `buildFixBacklog` turns a set of already-
 * gathered audit findings into a `DecomposedPlan` by feeding them through
 * `../decompose/decompose.js` — the same engine W5-07 built for turning
 * design-phase ticket drafts into a typed DAG. An audit finding IS a ticket
 * draft in miniature (problem + fix + verify), so reusing `decompose()`
 * here is the same move, not a parallel implementation.
 */
import { decompose } from '../decompose/decompose.js';
import type {
  DecomposedPlan,
  TicketDraftInput,
  TicketDraftType,
} from '../decompose/types.js';
import type { Deliverable } from '../phases/types.js';
import type { ModeDefinition, ModeStep } from './types.js';

function deliverable(id: string, producingRole: string): Deliverable {
  return { id, producingRole };
}

function step(id: string, name: string, deliverables: readonly Deliverable[]): ModeStep {
  return { id, name, deliverables };
}

export const IMPROVE_STEPS: readonly ModeStep[] = [
  step('discovery-audit', 'Discovery Audit', [
    deliverable('docs/improve/DISCOVERY_AUDIT.md', 'researcher'),
  ]),
  step('audits', 'Run Audits', [deliverable('docs/improve/*_AUDIT.md', 'code-reviewer')]),
  step('backlog', 'Synthesize Improvement Backlog', [
    deliverable('docs/improve/IMPROVEMENT_BACKLOG.md', 'sdlc-lead'),
  ]),
  step('execute', 'Execute Improvements', [deliverable('ticket-board', 'coding-agent')]),
];

export const IMPROVE_MODE: ModeDefinition = {
  id: 'improve',
  name: 'Improve',
  macroLoopCap: 2,
  steps: IMPROVE_STEPS,
};

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

/** One row of `docs/improve/IMPROVEMENT_BACKLOG.md`'s per-severity table
 * (Area | Problem | Size | Fix Summary | Verify With), plus the
 * `writeScope`/`dependsOn` a human or upstream specialist has already
 * scoped for it — this module never guesses those. */
export interface AuditFinding {
  readonly id: string;
  readonly area: string;
  readonly problem: string;
  readonly severity: AuditSeverity;
  readonly size: 'S' | 'M' | 'L';
  readonly fixSummary: string;
  readonly verifyWith: string;
  readonly writeScope: readonly string[];
  readonly dependsOn?: readonly string[];
}

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Stable sort, Critical -> Low (source doc's backlog section order). */
export function prioritizeFindings(
  findings: readonly AuditFinding[],
): readonly AuditFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function findingTicketType(finding: AuditFinding): TicketDraftType {
  return finding.severity === 'critical' || finding.severity === 'high' ? 'bug' : 'task';
}

export function findingToTicketDraft(finding: AuditFinding): TicketDraftInput {
  return {
    id: finding.id,
    type: findingTicketType(finding),
    title: `[${finding.area}] ${finding.problem}`,
    writeScope: finding.writeScope,
    dependsOn: finding.dependsOn ?? [],
    acceptance: [finding.fixSummary],
    verify: finding.verifyWith,
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
  };
}

export class DuplicateAuditFindingError extends Error {
  constructor(id: string) {
    super(`duplicate audit finding id: ${id}`);
    this.name = 'DuplicateAuditFindingError';
  }
}

/** Improve mode's audit + fix backlog "as tickets" (FR-P5 AC1). Prioritizes
 * by severity, then hands the drafts to `decompose()` for lane derivation,
 * plan-linting, and the Mermaid rendering — this function does not
 * re-implement any of that. */
export function buildFixBacklog(findings: readonly AuditFinding[]): DecomposedPlan {
  const seen = new Set<string>();
  for (const finding of findings) {
    if (seen.has(finding.id)) throw new DuplicateAuditFindingError(finding.id);
    seen.add(finding.id);
  }

  const prioritized = prioritizeFindings(findings);
  return decompose(prioritized.map(findingToTicketDraft));
}
