/**
 * Shared types and constants for the out-of-session close gate
 * (`loop-gates.ts`). Split out per CODE_BOOK_PROTOCOL.md (400-line file cap)
 * — `write_scope` for this ticket only grants single-segment
 * `packages/harbormaster/src/loop-gates*` paths (no subdirectory), so the
 * book split uses flat sibling chapter files sharing the `loop-gates`
 * prefix instead of a `loop-gates/` directory.
 */

import type { WorktreeHandle } from '@shipwright/git';
import type { SessionResult } from '@shipwright/loop';
import type { ValidatorGap } from '@shipwright/validators';
import type { EventLog, ReceiptRecord } from '@shipwright/events';
import type { Ticket } from '@shipwright/tickets';

/**
 * The untrusted Completion Manifest a session returns. `@shipwright/loop`'s
 * public barrel doesn't export the `CompletionManifest` type by name (only
 * `SessionResult`, whose `manifest` field carries it) — derived structurally
 * here rather than reaching past the barrel into a relative import.
 */
export type CompletionManifest = NonNullable<SessionResult['manifest']>;

/**
 * Wired per acceptance 4 (SC-06, BLUEPRINT §12.5 item 5): every close gate
 * runs the secrets scanner. `validate-remote-parity` is wired per W6-05
 * acceptance 2 (amplifier hole 11) so a diverged remote-tracking ref is a
 * real close-gate failure, not just a flag nothing ever reads.
 */
export const DEFAULT_REQUIRED_VALIDATORS: readonly string[] = [
  'secrets-scan',
  'validate-remote-parity',
];

export const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_VALIDATOR_TIMEOUT_MS = 30_000;

export interface CloseGateOptions {
  readonly log: EventLog;
  /** The Harbormaster worker identity that owns the ticket — `closeTicket`'s `assertOwner` requires this to equal `ticket.ownerId`. */
  readonly actorId: string;
  readonly projectId: string;
  readonly ticket: Ticket;
  readonly worktree: WorktreeHandle;
  /** The session's untrusted claim (SC-02). */
  readonly manifest: CompletionManifest;
  /** Commit-ish the ticket branch forked from (e.g. `main`); the real fork point is re-derived via `git merge-base`, so it's immune to `baseRef` moving forward afterward. */
  readonly baseRef: string;
  /** `content/validators` in production; a fixture directory in tests. */
  readonly contentDir: string;
  readonly signingKey: string;
  readonly requiredValidators?: readonly string[];
  readonly verifyTimeoutMs?: number;
  readonly validatorTimeoutMs?: number;
  readonly now?: () => string;
  readonly id?: string;
  readonly phase?: number | null;
  /** R-G2 (deferred until W7-01 lands): the session's role, checked against `memoryEligibleRoles`. */
  readonly role?: string;
  /** Roles whose manifest must carry a non-empty `memory_written[]`. Defaults to none — inert until W7-01 lands. */
  readonly memoryEligibleRoles?: readonly string[];
}

export interface CloseGateSuccess {
  readonly ok: true;
  readonly ticket: Ticket;
  readonly receipt: ReceiptRecord;
}

export interface CloseGateFailure {
  readonly ok: false;
  readonly ticket: Ticket;
  readonly reasons: readonly string[];
}

export type CloseGateResult = CloseGateSuccess | CloseGateFailure;

export interface VerifyRunResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ParsedGapLocation {
  readonly file: string;
  readonly line: number | null;
}

export interface SecretsGateSummary {
  readonly raw: number;
  readonly effective: number;
  readonly suppressed: number;
  readonly effectiveGaps: readonly ValidatorGap[];
}
