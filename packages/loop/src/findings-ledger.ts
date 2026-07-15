import {
  LEDGERED_SEVERITIES,
  computeFindingFingerprint,
  formatRerunLine,
  isValidRerun,
  requireHumanActor,
  type Actor,
  type FindingFunnel,
  type FindingLedgerEvent,
  type FindingRecord,
  type FindingState,
  type PassReportResult,
  type RawFinding,
  type RecheckInput,
  type RecheckResult,
  type RuleLifecycleState,
  type SuppressionJustification,
  type SuppressionRecord,
} from './findings-types.js';
import { FindingLedgerError } from './findings-types.js';

/**
 * The stateful finding ledger (CODE_BOOK_PROTOCOL chapter of findings.ts): ingests passes,
 * records recheck verdicts, and tracks suppressions. Pure engine like coverage.ts — returns
 * records/events, never writes to the event log itself (persistence is the orchestrator's job,
 * outside this write_scope).
 */

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
