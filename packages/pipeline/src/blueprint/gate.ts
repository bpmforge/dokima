/**
 * The decision-complete gate (FR-P7 / AC-2: "Phases 3-4 refuse to start
 * while any unresolved founder-decision marker remains"; ticket W5-04's own
 * acceptance: "the gate is a validator with red fixtures").
 *
 * `decideBlueprintUnlock` never trusts the blueprint's own claim of
 * completeness — it re-parses the raw markdown via `markers.ts` every call
 * (an "Open Questions: None" summary line proves nothing if a real
 * UNRESOLVED marker still sits elsewhere in the doc), and it cross-checks
 * every RESOLVED marker's cited D-ID against `ledgerMarkdown` (the real
 * `docs/DECISIONS.md` content, out of this write_scope's reach — the
 * wiring ticket supplies it, same seam shape as `decisions/ledger.ts`'s own
 * write_scope note). A RESOLVED marker citing a D-ID that doesn't exist in
 * the ledger is a spoofed resolution, not a decided question — the gate
 * refuses it exactly like a genuinely unresolved one (CLAUDE.md law #4:
 * nothing completes on a string match, the graded entity never grades
 * itself — a blueprint that asserts its own decision-completeness is
 * exactly that).
 */
import { citesDecisionId } from '../decisions/ledger.js';
import { parseMarkers } from './markers.js';
import type { LockedPhaseId } from './types.js';

export interface DecisionGateResult {
  readonly allowed: boolean;
  readonly phaseId: LockedPhaseId;
  readonly reasons: readonly string[];
}

export class UnresolvedFounderDecisionError extends Error {
  constructor(phaseId: LockedPhaseId, reasons: readonly string[]) {
    super(
      `phase ${phaseId} is locked — unresolved founder-decision marker(s) remain in the ` +
        `blueprint (FR-P7): ${reasons.join('; ')}`,
    );
    this.name = 'UnresolvedFounderDecisionError';
  }
}

/**
 * Decides whether `phaseId` (3 = Design, 4 = Build/decomposition — the only
 * two FR-P7 locks) may start, given the current blueprint markdown and the
 * current decisions ledger markdown. Never throws on a refusal — the
 * reasons are the point, same convention as `../phases/advance.ts`'s
 * `decideAdvance`.
 */
export function decideBlueprintUnlock(
  blueprintMarkdown: string,
  ledgerMarkdown: string,
  phaseId: LockedPhaseId,
): DecisionGateResult {
  const parsed = parseMarkers(blueprintMarkdown);
  const reasons: string[] = [];

  for (const u of parsed.unresolved) {
    reasons.push(`"${u.key}" is unresolved — founder has not answered its slate`);
  }
  for (const m of parsed.malformed) {
    reasons.push(`"${m.key}": ${m.reason}`);
  }
  for (const r of parsed.resolved) {
    if (!citesDecisionId(ledgerMarkdown, r.decisionId)) {
      reasons.push(
        `"${r.key}" claims resolution by ${r.decisionId}, but no such decision exists in ` +
          'docs/DECISIONS.md — refusing a spoofed resolution',
      );
    }
  }

  return { allowed: reasons.length === 0, phaseId, reasons };
}

/** Throwing form of `decideBlueprintUnlock`, for call sites that want a hard stop (mirrors `../phases/waiver-policy.ts`'s `assertWaiverEligible`). */
export function assertDecisionComplete(
  blueprintMarkdown: string,
  ledgerMarkdown: string,
  phaseId: LockedPhaseId,
): void {
  const result = decideBlueprintUnlock(blueprintMarkdown, ledgerMarkdown, phaseId);
  if (!result.allowed) {
    throw new UnresolvedFounderDecisionError(phaseId, result.reasons);
  }
}
