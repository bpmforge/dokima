/**
 * Shared types for the risk classifier and the autonomy dial (BLUEPRINT
 * §3.7, FR-N2).
 *
 * W13-45 removed the card types that lived here — `CardKind`, `DiffStat`,
 * `ReviewCard` and `CARD_KINDS` — along with `review-queue.ts`, the second
 * and unreachable implementation of the morning queue. The one users see is
 * built by apps/server's notification routes, and its `LEVERAGE_BY_KIND`
 * covers nine kinds against this copy's four. The copies had ALREADY
 * diverged: the shipped taxonomy calls the top-ranked kind `pr_ready` and
 * this one called it `merge`, at the same rank of 40.
 *
 * What remains is what the autonomy dial genuinely imports: the risk classes
 * and the action descriptor the rule-first classifier matches on.
 */

/**
 * The five risk classes an approval card can carry (DATABASE.md §4
 * `approvals_ledger.risk_class`, SRS FR-N2). Every doc that enumerates them
 * (BLUEPRINT §3.7, SRS FR-N2, DATABASE.md) lists them in this exact order —
 * adopted here as the canonical severity order, most severe first, so
 * "raise never lower" (FR-N2) has a concrete direction to check against.
 */
export const RISK_CLASSES = [
  'deploy',
  'main-merge',
  'destructive',
  'escalation',
  'budget',
] as const;

export type RiskClass = (typeof RISK_CLASSES)[number];

/**
 * Rule inputs describing a single action the Harbormaster is about to take,
 * before it takes it. Every field is something a rule can check
 * deterministically (no model judgement required) — FR-N2's "rule-first"
 * requirement.
 */
export interface ActionDescriptor {
  /** e.g. 'merge' | 'deploy' | 'release' | 'shell' | 'db' — free-form, rules match on it loosely. */
  readonly kind?: string;
  /** The branch an action would land on/from, when applicable. */
  readonly targetBranch?: string;
  /** The literal command about to run, when applicable (shell, migration, release script). */
  readonly command?: string;
  /** Paths this action would touch, when applicable. */
  readonly touchedPaths?: readonly string[];
  /** Write-scope violations already detected for this action (@dokima/loop's detectScopeViolations). */
  readonly scopeViolations?: readonly string[];
  /** Non-empty when this action would add a dependency not already in the tech-stack manifest. */
  readonly newDependencies?: readonly string[];
  /** Set when this action would cross an escalation-ladder tier boundary (D-018). */
  readonly escalation?: {
    readonly fromTier: string;
    readonly toTier: string;
    readonly crossesNamedTier: boolean;
  };
  /** Set when this action is gated behind a budget/spend threshold. */
  readonly spend?: {
    readonly fraction: number;
  };
}
