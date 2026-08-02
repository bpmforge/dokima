/**
 * Shared types for the morning-review queue + risk classifier
 * (BLUEPRINT §3.7/§5.2, FR-H4, FR-N2). Split per CODE_BOOK_PROTOCOL.md so
 * `review-queue-classifier.ts` and `review-queue.ts` share one vocabulary
 * without importing each other in a cycle.
 */

import type { ReceiptRecord } from '@dokima/events';

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

/** A card's position on the queue (BLUEPRINT §5.2: merges → approvals → clarifications → digests). */
export const CARD_KINDS = ['merge', 'approval', 'clarification', 'digest'] as const;

export type CardKind = (typeof CARD_KINDS)[number];

/** Derived from the ticket's own verified changed-file list — never self-reported (SC-02). */
export interface DiffStat {
  readonly filesChanged: number;
  readonly files: readonly string[];
}

/** One card on the morning-review queue (BLUEPRINT §5.2 AC-2: summary, diff-stat, receipts). */
export interface ReviewCard {
  readonly id: string;
  readonly kind: CardKind;
  readonly riskClass: RiskClass | null;
  readonly title: string;
  readonly summary: string;
  readonly diffStat: DiffStat;
  readonly receipts: readonly ReceiptRecord[];
  readonly ticketId: string | null;
  readonly leverage: number;
  readonly createdAt: string;
}
