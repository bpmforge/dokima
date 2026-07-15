import { createHash } from 'node:crypto';

/**
 * Shared primitives + finding identity for the finding ledger (CODE_BOOK_PROTOCOL chapter of
 * findings.ts — BLUEPRINT §3.5, FR-L6, docs/design/FINDING_LOOP_POLICY.md §1, DATABASE.md §5b).
 * No ledger state lives here: fingerprinting, evidence validation, and the record/event shapes
 * only. `findings-ledger.ts` owns the stateful tracker; `findings-rules.ts` the rule lifecycle;
 * `findings-infra.ts` the infra-failure taxonomy; `findings.ts` is the barrel re-exporting all
 * four (write_scope glob: `packages/loop/src/findings*`).
 */

// --- Shared primitives -----------------------------------------------------

/** Minimal actor projection (loop cannot import packages/tickets or events — ARCHITECTURE.md §4). */
export interface Actor {
  readonly id: string;
  readonly kind: 'human' | 'machine';
}

/** Shared by rule-state transitions (FR-RL2) and suppression (FR-RL3) — both are human-only, SC-05. */
export class ActorAuthorizationError extends Error {
  readonly code = 'MACHINE_ACTOR_FORBIDDEN' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ActorAuthorizationError';
  }
}

export function requireHumanActor(actor: Actor, action: string): void {
  if (actor.kind !== 'human') {
    throw new ActorAuthorizationError(
      `${action} refused: actor "${actor.id}" is a machine identity — this transition requires ` +
        'a human signature (FR-RL2/FR-RL3, SC-05)',
    );
  }
}

// --- Finding identity (FINDING_LOOP_POLICY.md §1) ---------------------------

export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Only HIGH/CRITICAL findings are ledgered (design doc §1: "Every HIGH/CRITICAL gets a finding record"). */
export const LEDGERED_SEVERITIES: readonly FindingSeverity[] = ['HIGH', 'CRITICAL'];

export type FindingState =
  'OPEN' | 'FIX_ATTEMPTED' | 'RESOLVED' | 'REGRESSED' | 'SUPPRESSED';

export interface RawFinding {
  readonly file: string;
  readonly category: string;
  readonly issue: string;
  readonly severity: FindingSeverity;
  readonly fixHint?: string;
  readonly ruleId?: string;
}

function normalizeIssueText(issue: string): string {
  return issue.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Stable fingerprint: hash(file, category, normalized issue) — FINDING_LOOP_POLICY.md §1. */
export function computeFindingFingerprint(
  file: string,
  category: string,
  issue: string,
): string {
  const normalized = `${file}\x00${category}\x00${normalizeIssueText(issue)}`;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** R-B2: the exact `<command, counts, exit code>` a recheck verdict must carry to count. */
export interface RerunEvidence {
  readonly command: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly exitCode: number;
}

export function isValidRerun(
  rerun: RerunEvidence | null | undefined,
): rerun is RerunEvidence {
  return (
    rerun != null &&
    typeof rerun.command === 'string' &&
    rerun.command.trim().length > 0 &&
    Number.isInteger(rerun.exitCode) &&
    typeof rerun.counts === 'object' &&
    rerun.counts !== null &&
    Object.keys(rerun.counts).length > 0
  );
}

/** Renders the literal `re-ran independently: ...` evidence line R-B2 requires on every counted verdict. */
export function formatRerunLine(rerun: RerunEvidence): string {
  return `re-ran independently: ${rerun.command}, counts=${JSON.stringify(rerun.counts)}, exit ${rerun.exitCode}`;
}

export interface FindingEvidenceEntry {
  readonly pass: number;
  readonly state: FindingState;
  readonly evidence: string;
  /** Present only for recheck-driven transitions (R-B2); null for open/regression/suppression entries. */
  readonly rerun: RerunEvidence | null;
}

export interface FindingRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly ticketId: string;
  readonly ruleId: string | null;
  readonly severity: FindingSeverity;
  readonly file: string;
  readonly issue: string;
  readonly fixHint: string | null;
  readonly state: FindingState;
  /** # of coder passes that explicitly targeted this finding and it was still STILL_PRESENT (FR-L6 fixture). */
  readonly attempts: number;
  /** Infra events attributed to this specific finding — never counted as attempts (R-D2). */
  readonly freeRetries: number;
  /** Shadow-rule findings (FR-RL1): excluded from gates/scores/blocks/plans. */
  readonly experimental: boolean;
  readonly firstSeenPass: number;
  readonly history: readonly FindingEvidenceEntry[];
  readonly createdAt: string;
}

export interface FindingLedgerEvent {
  readonly eventType:
    | 'finding.opened'
    | 'finding.recheck_recorded'
    | 'finding.recheck_rejected'
    | 'finding.regressed'
    | 'finding.suppressed'
    | 'finding.reopened'
    | 'finding.infra_failure_recorded';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FindingFunnel {
  /** Raw HIGH/CRITICAL findings received this call (FR-RL4). */
  readonly raw: number;
  /** Distinct fingerprints ever seen. */
  readonly deduped: number;
  /** Open (OPEN/FIX_ATTEMPTED/REGRESSED), non-experimental — what actually gates. */
  readonly effective: number;
  /** Currently SUPPRESSED (active). */
  readonly suppressed: number;
}

export type FindingLedgerErrorCode = 'UNKNOWN_FINDING' | 'DUPLICATE_TICKET_MISMATCH';

export class FindingLedgerError extends Error {
  readonly code: FindingLedgerErrorCode;

  constructor(code: FindingLedgerErrorCode, message: string) {
    super(message);
    this.name = 'FindingLedgerError';
    this.code = code;
  }
}

export interface PassReportResult {
  readonly pass: number;
  readonly newFindings: readonly FindingRecord[];
  readonly stillPresentFingerprints: readonly string[];
  readonly regressedFindings: readonly FindingRecord[];
  readonly funnel: FindingFunnel;
}

export interface RecheckInput {
  readonly fingerprint: string;
  readonly pass: number;
  readonly outcome: 'RESOLVED' | 'STILL_PRESENT';
  readonly rerun: RerunEvidence | null;
}

export interface RecheckIncomplete {
  readonly status: 'INCOMPLETE';
  readonly fingerprint: string;
  readonly reason: string;
}

export interface RecheckRecorded {
  readonly status: 'RECORDED';
  readonly finding: FindingRecord;
}

export type RecheckResult = RecheckIncomplete | RecheckRecorded;

export type SuppressionJustification =
  | 'false_positive'
  | 'not_applicable_scope'
  | 'accepted_risk'
  | 'fixed_elsewhere'
  | 'wont_fix_documented';

export interface SuppressionRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly ruleId: string | null;
  readonly justification: SuppressionJustification;
  readonly signedBy: Actor;
  readonly contextKey: string;
  readonly status: 'active' | 'reopened';
  readonly createdAt: string;
  readonly reopenedAt: string | null;
}

export type RuleLifecycleState =
  'proposed' | 'shadow' | 'advisory' | 'gate' | 'deprecated';
