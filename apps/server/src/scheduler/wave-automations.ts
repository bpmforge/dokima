/**
 * Wave automations (P4-01) — trigger-driven extensions of the EXISTING
 * scheduler layer (plan-scheduler.ts), not a new automation system. Three
 * automations, all Review-tier:
 *
 *   - `pollBranchAdvisoryReviews`: when a parked candidate branch gains a new
 *     head, run the Tier-A advisory review (injected — the wave-review path)
 *     and RECORD the findings. Nothing is merged, accepted, or reverted.
 *     STARTED at server boot since P6-13 (wave-automations-wiring.ts).
 *   - `runDependencySweep` (STARTED at server boot since P6-14, daily per
 *     project): on a schedule, turn an audit result into ticket
 *     PROPOSALS (injected writer) — the same propose-then-human-accepts shape
 *     `evaluatePlan` already uses. Producing prose instead of proposals is how
 *     sweeps rot; producing merges instead of proposals would be Decide-tier.
 *   - `postMergeSmoke` (STARTED at server boot since P6-14, triggered by
 *     feature.landed events): after a merge
 *     event, run the injected smoke command;
 *     the FIRST failure notifies (Review-tier), the SECOND consecutive failure
 *     escalates to a human — the Amplitude pattern the design doc cites
 *     ("fails twice, bring in a human"). Never an auto-revert.
 *
 * ZERO DECIDE-TIER AUTO-ACTIONS — the same constraint plan-scheduler.ts
 * states and its tests pin. This module takes NO accept/merge/revert
 * capability in any options object; a caller cannot even wire one in, which
 * is the strongest form of the promise.
 *
 * AUTO-MERGE IS DELIBERATELY NOT IMPLEMENTED. Risk-tiered auto-merge (the
 * "low-risk lands itself" idea) is a founder decision recorded as open in
 * the program plan (§ T4 / EXECUTION_PLAN decision 4); building it here
 * unasked would decide it by shipping. If it is ever approved, it becomes
 * its own ticket with its own red fixtures — not an option on this module.
 */

export interface AdvisoryReviewFinding {
  readonly severity: string;
  readonly file: string;
  readonly issue: string;
}

export interface BranchCursorStore {
  lastReviewedHead(branch: string): string | undefined;
  markReviewed(branch: string, head: string): void;
}

/** In-memory cursor store; the server process swaps in a persisted one. */
export function createMemoryBranchCursor(): BranchCursorStore {
  const seen = new Map<string, string>();
  return {
    lastReviewedHead: (b) => seen.get(b),
    markReviewed: (b, h) => void seen.set(b, h),
  };
}

export async function pollBranchAdvisoryReviews(opts: {
  listCandidateBranches: () => Promise<ReadonlyArray<{ branch: string; head: string }>>;
  runAdvisoryReview: (
    branch: string,
    head: string,
  ) => Promise<ReadonlyArray<AdvisoryReviewFinding>>;
  cursor: BranchCursorStore;
  notify: (message: string) => void;
  onError?: (branch: string, err: unknown) => void;
}): Promise<{ reviewed: string[]; skipped: string[] }> {
  const reviewed: string[] = [];
  const skipped: string[] = [];
  const branches = await opts.listCandidateBranches();
  for (const { branch, head } of branches) {
    // One branch's failure must not sink the tick (the plan-scheduler rule).
    try {
      if (opts.cursor.lastReviewedHead(branch) === head) {
        skipped.push(branch);
        continue;
      }
      const findings = await opts.runAdvisoryReview(branch, head);
      // Cursor advances ONLY after a successful pass (at-least-once).
      opts.cursor.markReviewed(branch, head);
      reviewed.push(branch);
      if (findings.length) {
        opts.notify(
          `advisory review of ${branch}@${head.slice(0, 8)}: ${findings.length} finding(s) — ` +
            findings
              .slice(0, 3)
              .map((f) => `[${f.severity}] ${f.file}: ${f.issue}`)
              .join(' | '),
        );
      }
    } catch (err) {
      (opts.onError ?? (() => {}))(branch, err);
    }
  }
  return { reviewed, skipped };
}

export interface AuditFinding {
  readonly pkg: string;
  readonly severity: string;
  readonly advisory: string;
}

export async function runDependencySweep(opts: {
  runAudit: () => Promise<readonly AuditFinding[]>;
  proposeTicket: (proposal: {
    title: string;
    severity: string;
    evidence: string;
  }) => void;
  notify: (message: string) => void;
  minSeverity?: 'critical' | 'high' | 'moderate';
}): Promise<{ proposed: number }> {
  const rank: Record<string, number> = { critical: 3, high: 2, moderate: 1, low: 0 };
  const floor = rank[opts.minSeverity ?? 'high'] ?? 2;
  const findings = await opts.runAudit();
  let proposed = 0;
  for (const f of findings) {
    if ((rank[f.severity.toLowerCase()] ?? 0) < floor) continue;
    // A PROPOSAL, not a ticket in flight: a human accepts it onto the board.
    opts.proposeTicket({
      title: `deps: ${f.pkg} — ${f.severity} advisory`,
      severity: f.severity,
      evidence: f.advisory,
    });
    proposed++;
  }
  if (proposed)
    opts.notify(`dependency sweep proposed ${proposed} ticket(s) for human acceptance`);
  return { proposed };
}

export interface SmokeState {
  consecutiveFailures: number;
}

export async function postMergeSmoke(opts: {
  runSmoke: () => Promise<{ ok: boolean; detail: string }>;
  state: SmokeState;
  notify: (message: string) => void;
  escalateToHuman: (message: string) => void;
}): Promise<{ ok: boolean; escalated: boolean }> {
  const r = await opts.runSmoke();
  if (r.ok) {
    opts.state.consecutiveFailures = 0;
    return { ok: true, escalated: false };
  }
  opts.state.consecutiveFailures += 1;
  if (opts.state.consecutiveFailures >= 2) {
    // Second consecutive failure: the automation stops retrying and brings in
    // a human. It never auto-reverts — that would be a Decide-tier action.
    opts.escalateToHuman(
      `post-merge smoke failed ${opts.state.consecutiveFailures}x consecutively — human needed: ${r.detail}`,
    );
    return { ok: false, escalated: true };
  }
  opts.notify(`post-merge smoke failed (1st) — will retry next tick: ${r.detail}`);
  return { ok: false, escalated: false };
}

/** Timer wiring, mirroring startPlanScheduler: tests drive the functions directly. */
export function startWaveAutomations(opts: {
  tick: () => Promise<void>;
  intervalMs?: number;
}): () => void {
  const handle = setInterval(
    () => {
      void opts
        .tick()
        .catch((err) => console.error('[wave-automations] tick failed:', err));
    },
    opts.intervalMs ?? 5 * 60_000,
  );
  if (typeof handle === 'object' && handle && 'unref' in handle) handle.unref();
  return () => clearInterval(handle);
}
