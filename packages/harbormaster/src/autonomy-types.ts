/**
 * Shared types for the autonomy dial + approvals ledger (BLUEPRINT §3.7/§5.2,
 * SRS FR-N3, CONSTRAINTS.md C-5, SECURITY_CONTROLS.md SC-05/SC-10, US-703).
 * Split per CODE_BOOK_PROTOCOL.md so `autonomy-ledger.ts` (minting/reading/
 * validating) and `autonomy.ts` (mode policy + the claim-gate) share one
 * vocabulary without importing each other in a cycle.
 */

import { NEVER_AUTO_RISK_CLASSES } from './review-queue-classifier.js';
import { RISK_CLASSES, type RiskClass } from './review-queue-types.js';

export type AutonomyMode = 'interactive' | 'auto';

/**
 * A pause site is either an action shaped enough to risk-classify
 * (`RiskClass`, W3-05's `review-queue-classifier.ts`) or a non-action pause
 * that carries no `ActionDescriptor` to classify: `'interview'` (SDLC phase
 * 0/1 discovery interviews, CONSTRAINTS.md C-5) and `'clarification'`
 * (FR-N1 questions, US-701 — auto-eligible, unlike interviews).
 */
export type PauseSiteKind = RiskClass | 'interview' | 'clarification';

export const LEDGER_DECISIONS = ['approved', 'rejected', 'auto-default'] as const;

export type LedgerDecision = (typeof LEDGER_DECISIONS)[number];

/**
 * The immutable NEVER-AUTO pause-site set (CONSTRAINTS.md C-5, SC-10 "compiled
 * into packages/harbormaster — not config, not DB, no API mutates it"). Built
 * by extending W3-05's already-frozen, already-tested `NEVER_AUTO_RISK_CLASSES`
 * (deploy/main-merge/destructive — the last folding in auth/crypto changes,
 * scope-boundary breaks, and new-stack additions per that module's own
 * comment) with `'interview'`, the one C-5 item no `ActionDescriptor` can ever
 * express. This is a single extension, not a second parallel list — the two
 * NEVER-AUTO lists in this package cannot drift because one is derived from
 * the other. There is no exported setter; `Object.freeze` makes an in-place
 * mutation attempt throw (strict mode, ESM default) rather than silently
 * succeed (SRS FR-N3 "attempt to edit NEVER-AUTO via API/UI refused").
 */
export const NEVER_AUTO_PAUSE_SITES: readonly PauseSiteKind[] = Object.freeze([
  ...NEVER_AUTO_RISK_CLASSES,
  'interview',
]);

/**
 * Every recognized `PauseSiteKind` value (the five `RiskClass`es plus
 * `'interview'`/`'clarification'`) — the enum this module actually has, for
 * validating an untrusted `pauseSite` string against rather than trusting
 * its static type. A ledger row's `pauseSite` is read back from event
 * payload JSON (or, at a call site, may be a value an untrusted agent
 * session supplied), so nothing prevents it from being a typo, stray
 * whitespace, wrong case, or a value nobody defined — TypeScript's
 * compile-time `PauseSiteKind` type offers no runtime protection there.
 */
export const ALL_PAUSE_SITE_KINDS: readonly PauseSiteKind[] = Object.freeze([
  ...RISK_CLASSES,
  'interview',
  'clarification',
]);

/** True when `value` is one of the known `PauseSiteKind` enum members. */
export function isPauseSiteKind(value: unknown): value is PauseSiteKind {
  return (
    typeof value === 'string' &&
    (ALL_PAUSE_SITE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * True when `pauseSite` falls in the unconditional NEVER-AUTO set. Fails
 * closed: a `pauseSite` that isn't a recognized `PauseSiteKind` member at
 * all (typo, stale/renamed constant, forged value) is treated as NEVER-AUTO
 * rather than silently falling through to auto-eligible — an unrecognized
 * site is exactly the case where we cannot prove it's safe to auto-resolve
 * (FR-N3, CONSTRAINTS.md C-5).
 */
export function isNeverAutoPauseSite(pauseSite: PauseSiteKind): boolean {
  if (!isPauseSiteKind(pauseSite)) return true;
  return (NEVER_AUTO_PAUSE_SITES as readonly string[]).includes(pauseSite);
}

/**
 * One approvals-ledger row (DATABASE.md §4 `approvals_ledger`), reconstructed
 * from its anchoring event. `id`/`runId`/`pauseSite`/... are caller-supplied
 * payload fields; `createdAt` is always the anchoring event's own timestamp
 * (stamped by `appendEvent`, chain-covered) — never a payload field, so it
 * cannot be backdated by whoever built the payload.
 */
export interface AutonomyLedgerRow {
  readonly id: string;
  readonly runId: string | null;
  readonly pauseSite: PauseSiteKind;
  readonly mode: AutonomyMode;
  /** What was decided when `decision === 'auto-default'`; null for human decisions (US-703 AC-1). */
  readonly defaultTaken: string | null;
  /** What would have been asked of a human (US-703 AC-1). */
  readonly wouldHaveAsked: string;
  /** The identity that appended this row (machine for auto-defaults, the signer for human decisions). */
  readonly decidedBy: string | null;
  /** Human identity id that signed a NEVER-AUTO decision; null for auto-default rows (FR-N3, SC-05). */
  readonly humanSignature: string | null;
  readonly decision: LedgerDecision;
  readonly createdAt: string;
}
