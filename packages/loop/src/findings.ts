import { createHash } from 'node:crypto';

/**
 * Finding ledger (BLUEPRINT §3.5, FR-L6, docs/design/FINDING_LOOP_POLICY.md
 * §1, DATABASE.md §5b): every HIGH/CRITICAL review finding becomes a stable
 * record keyed by a content fingerprint, not an anonymous per-pass string.
 * Rechecks return per-finding verdicts and must carry independent re-run
 * evidence (R-B2) or are bounced as INCOMPLETE without touching the ledger.
 * Rule lifecycle (FR-RL1/2), suppression (FR-RL3) and the funnel (FR-RL4)
 * live alongside the ledger they gate. Like coverage.ts/calibration.ts, this
 * is the pure engine: it returns records and event-shaped payloads rather
 * than writing to the event log itself — persistence is the orchestrator's
 * job (harbormaster/pipeline), outside this write_scope.
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

function requireHumanActor(actor: Actor, action: string): void {
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
const LEDGERED_SEVERITIES: readonly FindingSeverity[] = ['HIGH', 'CRITICAL'];

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

function isValidRerun(rerun: RerunEvidence | null | undefined): rerun is RerunEvidence {
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

export interface FindingLedgerOptions {
  readonly now?: () => string;
  /** Looks up a raw finding's rule lifecycle state to decide the `experimental` stamp (FR-RL1). */
  readonly resolveRuleState?: (ruleId: string) => RuleLifecycleState | undefined;
}

export interface ReportPassOptions {
  /** Per-call override of the ledger's default rule-state resolver. */
  readonly resolveRuleState?: (ruleId: string) => RuleLifecycleState | undefined;
}

export interface FindingLedger {
  readonly findings: readonly FindingRecord[];
  readonly events: readonly FindingLedgerEvent[];
  readonly suppressions: readonly SuppressionRecord[];
  get(fingerprint: string): FindingRecord | undefined;
  /** Ingests one pass's raw findings; only HIGH/CRITICAL are ledgered (design doc §1). */
  reportPass(
    rawFindings: readonly RawFinding[],
    pass: number,
    opts?: ReportPassOptions,
  ): PassReportResult;
  /** Records a per-finding verdict; rejects INCOMPLETE without any ledger write when evidence is missing (R-B2). */
  recheck(input: RecheckInput): RecheckResult;
  /** An infra event attributed to one finding's recheck attempt — bumps free_retries only, never attempts/state/history (R-D2). */
  recordFindingInfraFailure(fingerprint: string, pass: number): FindingRecord;
  suppress(
    fingerprint: string,
    justification: SuppressionJustification,
    signedBy: Actor,
    contextKey: string,
    pass: number,
  ): SuppressionRecord;
  /** Auto-reopens a suppression whose context_key no longer matches the observed one (FR-RL3). */
  reopenIfContextChanged(
    fingerprint: string,
    currentContextKey: string,
    pass: number,
  ): SuppressionRecord;
}

export function createFindingLedger(
  ticketId: string,
  opts: FindingLedgerOptions = {},
): FindingLedger {
  const now = opts.now ?? (() => new Date().toISOString());
  const findings = new Map<string, FindingRecord>();
  const suppressions = new Map<string, SuppressionRecord>();
  const events: FindingLedgerEvent[] = [];
  let counter = 0;
  let suppressionCounter = 0;

  function requireFinding(fingerprint: string): FindingRecord {
    const finding = findings.get(fingerprint);
    if (!finding) {
      throw new FindingLedgerError(
        'UNKNOWN_FINDING',
        `no finding with fingerprint "${fingerprint}" in ticket "${ticketId}"'s ledger`,
      );
    }
    return finding;
  }

  function openFinding(
    raw: RawFinding,
    fingerprint: string,
    pass: number,
    experimental: boolean,
  ): FindingRecord {
    counter += 1;
    const record: FindingRecord = {
      id: `F-${ticketId}-${counter}`,
      fingerprint,
      ticketId,
      ruleId: raw.ruleId ?? null,
      severity: raw.severity,
      file: raw.file,
      issue: raw.issue,
      fixHint: raw.fixHint ?? null,
      state: 'OPEN',
      attempts: 0,
      freeRetries: 0,
      experimental,
      firstSeenPass: pass,
      history: [
        {
          pass,
          state: 'OPEN',
          evidence: `first sighted at pass ${pass}`,
          rerun: null,
        },
      ],
      createdAt: now(),
    };
    findings.set(fingerprint, record);
    events.push({
      eventType: 'finding.opened',
      payload: {
        id: record.id,
        fingerprint,
        ticketId,
        severity: raw.severity,
        experimental,
      },
    });
    return record;
  }

  function regressFinding(finding: FindingRecord, pass: number): FindingRecord {
    const updated: FindingRecord = {
      ...finding,
      state: 'REGRESSED',
      history: [
        ...finding.history,
        {
          pass,
          state: 'REGRESSED',
          evidence: `reappeared at pass ${pass} after having been RESOLVED`,
          rerun: null,
        },
      ],
    };
    findings.set(finding.fingerprint, updated);
    events.push({
      eventType: 'finding.regressed',
      payload: { id: finding.id, fingerprint: finding.fingerprint, pass },
    });
    return updated;
  }

  return {
    get findings() {
      return Array.from(findings.values());
    },
    get events() {
      return events.slice();
    },
    get suppressions() {
      return Array.from(suppressions.values());
    },
    get(fingerprint) {
      return findings.get(fingerprint);
    },
    reportPass(rawFindings, pass, callOpts = {}) {
      const resolveRuleState = callOpts.resolveRuleState ?? opts.resolveRuleState;
      const ledgered = rawFindings.filter((raw) =>
        LEDGERED_SEVERITIES.includes(raw.severity),
      );
      const newFindings: FindingRecord[] = [];
      const stillPresentFingerprints: string[] = [];
      const regressedFindings: FindingRecord[] = [];

      for (const raw of ledgered) {
        const fingerprint = computeFindingFingerprint(raw.file, raw.category, raw.issue);
        const existing = findings.get(fingerprint);
        if (!existing) {
          const ruleState = raw.ruleId ? resolveRuleState?.(raw.ruleId) : undefined;
          const experimental = ruleState === 'shadow';
          newFindings.push(openFinding(raw, fingerprint, pass, experimental));
        } else if (existing.state === 'RESOLVED') {
          regressedFindings.push(regressFinding(existing, pass));
        } else if (existing.state === 'SUPPRESSED') {
          // Suppression stands until an explicit context-change reopen (FR-RL3) — reappearing
          // in a raw pass alone never overrides a signed suppression.
        } else {
          stillPresentFingerprints.push(fingerprint);
        }
      }

      const all = Array.from(findings.values());
      const funnel: FindingFunnel = {
        raw: ledgered.length,
        deduped: all.length,
        effective: all.filter(
          (f) =>
            !f.experimental &&
            (f.state === 'OPEN' ||
              f.state === 'FIX_ATTEMPTED' ||
              f.state === 'REGRESSED'),
        ).length,
        suppressed: all.filter((f) => f.state === 'SUPPRESSED').length,
      };

      return { pass, newFindings, stillPresentFingerprints, regressedFindings, funnel };
    },
    recheck(input) {
      const finding = requireFinding(input.fingerprint);
      if (!isValidRerun(input.rerun)) {
        events.push({
          eventType: 'finding.recheck_rejected',
          payload: {
            fingerprint: input.fingerprint,
            pass: input.pass,
            reason: 'missing re-run evidence',
          },
        });
        return {
          status: 'INCOMPLETE',
          fingerprint: input.fingerprint,
          reason:
            'verdict rejected INCOMPLETE: missing "re-ran independently: <command, counts, exit code>" evidence (R-B2)',
        };
      }
      const rerun = input.rerun;
      const newState: FindingState =
        input.outcome === 'RESOLVED' ? 'RESOLVED' : 'FIX_ATTEMPTED';
      const attempts =
        input.outcome === 'STILL_PRESENT' ? finding.attempts + 1 : finding.attempts;
      const updated: FindingRecord = {
        ...finding,
        state: newState,
        attempts,
        history: [
          ...finding.history,
          {
            pass: input.pass,
            state: newState,
            evidence: `${input.outcome === 'RESOLVED' ? 'RESOLVED' : 'STILL-PRESENT'} — ${formatRerunLine(rerun)}`,
            rerun,
          },
        ],
      };
      findings.set(finding.fingerprint, updated);
      events.push({
        eventType: 'finding.recheck_recorded',
        payload: {
          id: finding.id,
          fingerprint: finding.fingerprint,
          pass: input.pass,
          outcome: input.outcome,
        },
      });
      return { status: 'RECORDED', finding: updated };
    },
    recordFindingInfraFailure(fingerprint, pass) {
      const finding = requireFinding(fingerprint);
      const updated: FindingRecord = { ...finding, freeRetries: finding.freeRetries + 1 };
      findings.set(fingerprint, updated);
      events.push({
        eventType: 'finding.infra_failure_recorded',
        payload: { id: finding.id, fingerprint, pass },
      });
      return updated;
    },
    suppress(fingerprint, justification, signedBy, contextKey, pass) {
      requireHumanActor(signedBy, 'suppression');
      const finding = requireFinding(fingerprint);
      suppressionCounter += 1;
      const record: SuppressionRecord = {
        id: `S-${ticketId}-${suppressionCounter}`,
        fingerprint,
        ruleId: finding.ruleId,
        justification,
        signedBy,
        contextKey,
        status: 'active',
        createdAt: now(),
        reopenedAt: null,
      };
      suppressions.set(fingerprint, record);
      const updated: FindingRecord = {
        ...finding,
        state: 'SUPPRESSED',
        history: [
          ...finding.history,
          {
            pass,
            state: 'SUPPRESSED',
            evidence: `suppressed by ${signedBy.id}: ${justification}`,
            rerun: null,
          },
        ],
      };
      findings.set(fingerprint, updated);
      events.push({
        eventType: 'finding.suppressed',
        payload: { fingerprint, justification, signedBy: signedBy.id, contextKey },
      });
      return record;
    },
    reopenIfContextChanged(fingerprint, currentContextKey, pass) {
      const suppression = suppressions.get(fingerprint);
      if (!suppression) {
        throw new FindingLedgerError(
          'UNKNOWN_FINDING',
          `no active suppression for fingerprint "${fingerprint}"`,
        );
      }
      if (
        suppression.status !== 'active' ||
        suppression.contextKey === currentContextKey
      ) {
        return suppression;
      }
      const reopened: SuppressionRecord = {
        ...suppression,
        status: 'reopened',
        reopenedAt: now(),
      };
      suppressions.set(fingerprint, reopened);
      const finding = requireFinding(fingerprint);
      const updated: FindingRecord = {
        ...finding,
        state: 'OPEN',
        history: [
          ...finding.history,
          {
            pass,
            state: 'OPEN',
            evidence: `auto-reopened at pass ${pass}: suppression context changed (was "${suppression.contextKey}", now "${currentContextKey}")`,
            rerun: null,
          },
        ],
      };
      findings.set(fingerprint, updated);
      events.push({
        eventType: 'finding.reopened',
        payload: {
          fingerprint,
          previousContextKey: suppression.contextKey,
          currentContextKey,
        },
      });
      return reopened;
    },
  };
}

// --- Infra-failure taxonomy (R-D2) ------------------------------------------

/** Explicit infra-failure taxonomy (R-D2) — never a finding, never an attempt, never a per-rule FP signal. */
export type InfraFailureKind =
  'unparseable_review' | 'limit_pause' | 'watchdog_kill' | 'output_buffer_overflow';

export const INFRA_FAILURE_KINDS: readonly InfraFailureKind[] = [
  'unparseable_review',
  'limit_pause',
  'watchdog_kill',
  'output_buffer_overflow',
];

export interface InfraFailureTracker {
  readonly total: number;
  readonly counts: Readonly<Record<InfraFailureKind, number>>;
  /** Retries the review for free — zero ledger writes; this tracker never touches a FindingLedger. */
  record(kind: InfraFailureKind): void;
}

/**
 * Whole-review infra failures (unparseable output, provider-limit pause) happen before any
 * finding can be attributed, so this tracker is deliberately independent of FindingLedger and
 * RuleStateStore — recording one can never open a finding, consume an attempt, or move an
 * FP-rate metric (AC "retry free with zero ledger writes").
 */
export function createInfraFailureTracker(): InfraFailureTracker {
  const counts: Record<InfraFailureKind, number> = {
    unparseable_review: 0,
    limit_pause: 0,
    watchdog_kill: 0,
    output_buffer_overflow: 0,
  };
  let total = 0;
  return {
    get total() {
      return total;
    },
    get counts() {
      return { ...counts };
    },
    record(kind) {
      counts[kind] += 1;
      total += 1;
    },
  };
}

// --- Rule lifecycle + FP bookkeeping (FR-RL1/2, DATABASE.md §5b) -----------

export interface RuleState {
  readonly ruleId: string;
  readonly state: RuleLifecycleState;
  readonly fpWindowFindings: number;
  readonly fpWindowFps: number;
  /** Derived: fpWindowFps / fpWindowFindings, 0 when no findings observed yet. */
  readonly fpRate: number;
  readonly promotedAt: string | null;
  readonly demotionFlagged: boolean;
  readonly updatedAt: string;
}

export type RuleStateErrorCode =
  'UNKNOWN_RULE' | 'BELOW_SAMPLE_MINIMUM' | 'FP_RATE_TOO_HIGH' | 'INVALID_TRANSITION';

export class RuleStateError extends Error {
  readonly code: RuleStateErrorCode;

  constructor(code: RuleStateErrorCode, message: string) {
    super(message);
    this.name = 'RuleStateError';
    this.code = code;
  }
}

/** Trailing FP rate above this on a `gate`-state rule auto-flags demotion. */
export const DEMOTION_FP_THRESHOLD = 0.5;

export interface PromotionCriteria {
  readonly minSampleCount: number;
  readonly maxFpRate: number;
}

export interface RuleStateStore {
  readonly rules: readonly RuleState[];
  get(ruleId: string): RuleState | undefined;
  register(ruleId: string): RuleState;
  /** Folds one FP/TP outcome into the rule's trailing window; never call this for infra-failure-derived findings (R-D2). */
  recordOutcome(ruleId: string, isFalsePositive: boolean): RuleState;
  /** Human-only (FR-RL2: "No LLM code path can change a rule's state"). */
  transition(ruleId: string, to: RuleLifecycleState, actor: Actor): RuleState;
  /** shadow/advisory -> gate; refuses below the FP sample minimum or above the max FP rate, with counts shown. */
  promote(ruleId: string, actor: Actor, criteria: PromotionCriteria): RuleState;
}

export function createRuleStateStore(opts: { now?: () => string } = {}): RuleStateStore {
  const now = opts.now ?? (() => new Date().toISOString());
  const rules = new Map<string, RuleState>();

  function requireRule(ruleId: string): RuleState {
    const state = rules.get(ruleId);
    if (!state) {
      throw new RuleStateError('UNKNOWN_RULE', `rule "${ruleId}" is not registered`);
    }
    return state;
  }

  return {
    get rules() {
      return Array.from(rules.values());
    },
    get(ruleId) {
      return rules.get(ruleId);
    },
    register(ruleId) {
      if (rules.has(ruleId)) {
        return rules.get(ruleId)!;
      }
      const state: RuleState = {
        ruleId,
        state: 'proposed',
        fpWindowFindings: 0,
        fpWindowFps: 0,
        fpRate: 0,
        promotedAt: null,
        demotionFlagged: false,
        updatedAt: now(),
      };
      rules.set(ruleId, state);
      return state;
    },
    recordOutcome(ruleId, isFalsePositive) {
      const current = requireRule(ruleId);
      const fpWindowFindings = current.fpWindowFindings + 1;
      const fpWindowFps = current.fpWindowFps + (isFalsePositive ? 1 : 0);
      const fpRate = fpWindowFps / fpWindowFindings;
      const demotionFlagged =
        current.state === 'gate' && fpRate > DEMOTION_FP_THRESHOLD
          ? true
          : current.demotionFlagged;
      const updated: RuleState = {
        ...current,
        fpWindowFindings,
        fpWindowFps,
        fpRate,
        demotionFlagged,
        updatedAt: now(),
      };
      rules.set(ruleId, updated);
      return updated;
    },
    transition(ruleId, to, actor) {
      requireHumanActor(actor, `rule "${ruleId}" transition to "${to}"`);
      const current = requireRule(ruleId);
      const updated: RuleState = { ...current, state: to, updatedAt: now() };
      rules.set(ruleId, updated);
      return updated;
    },
    promote(ruleId, actor, criteria) {
      requireHumanActor(actor, `rule "${ruleId}" promotion`);
      const current = requireRule(ruleId);
      if (current.state !== 'shadow' && current.state !== 'advisory') {
        throw new RuleStateError(
          'INVALID_TRANSITION',
          `rule "${ruleId}" cannot promote to "gate" from state "${current.state}"`,
        );
      }
      if (current.fpWindowFindings < criteria.minSampleCount) {
        throw new RuleStateError(
          'BELOW_SAMPLE_MINIMUM',
          `rule "${ruleId}" promotion refused: ${current.fpWindowFindings} findings observed, ` +
            `minimum ${criteria.minSampleCount} required`,
        );
      }
      if (current.fpRate > criteria.maxFpRate) {
        throw new RuleStateError(
          'FP_RATE_TOO_HIGH',
          `rule "${ruleId}" promotion refused: FP rate ${current.fpRate} exceeds threshold ${criteria.maxFpRate} ` +
            `(${current.fpWindowFps}/${current.fpWindowFindings})`,
        );
      }
      const updated: RuleState = {
        ...current,
        state: 'gate',
        promotedAt: now(),
        demotionFlagged: false,
        updatedAt: now(),
      };
      rules.set(ruleId, updated);
      return updated;
    },
  };
}

// --- Funnel exposure (FR-RL4) ------------------------------------------------

/**
 * Same shape `reportPass` returns, exposed as a standalone read for callers who only hold the
 * ledger between passes (no fresh raw-findings batch to hand it). `raw` degrades to `deduped`
 * here since the ledger itself only tracks distinct fingerprints, not a running raw-submission
 * count — `reportPass`'s own return value is the source of truth for a given pass's raw count.
 */
export function computeFindingFunnel(ledger: FindingLedger): FindingFunnel {
  const all = ledger.findings;
  return {
    raw: all.length,
    deduped: all.length,
    effective: all.filter(
      (f) =>
        !f.experimental &&
        (f.state === 'OPEN' || f.state === 'FIX_ATTEMPTED' || f.state === 'REGRESSED'),
    ).length,
    suppressed: all.filter((f) => f.state === 'SUPPRESSED').length,
  };
}
