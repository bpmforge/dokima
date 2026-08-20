/**
 * ux-audit mode — the judge half of the design-review loop (W13-55,
 * docs/design/DESIGN_REVIEW_LOOP.md layer 3).
 *
 * Everything here is PURE: prompt assembly, response validation, citation
 * verification, and the mapping into the plans funnel. The model call itself
 * lives in apps/server's dispatch (code reads, model judges — the
 * onboard-mode precedent), and tests exercise this module with scripted
 * judgments, never a live call (Law 9a).
 *
 * THE CONTRACT THAT MAKES A CHEAP MODEL SAFE TO USE AS THE JUDGE: every
 * finding must carry a `citation` — an exact string the named evidence pack
 * contains. `verifyCitations` re-greps each one; a finding whose citation is
 * absent is DROPPED and reported, never trusted (C-2/C-3). The model's
 * judgment picks what matters; the evidence decides what is real.
 */

/** One captured UI state, as `capture-tour`'s evidence.json serializes it (W13-54). */
export interface UxEvidenceState {
  readonly id: string;
  readonly strings: readonly string[];
  readonly interactive?: readonly { readonly name: string }[];
  readonly geometry?: {
    readonly occupancy: number;
    readonly viewport: { readonly w: number; readonly h: number };
  };
  readonly classHistogram?: Readonly<Record<string, number>>;
}

export type UxAuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface UxAuditJudgment {
  readonly id: string;
  readonly state: string;
  readonly problem: string;
  readonly severity: UxAuditSeverity;
  /** An exact string from the named state's evidence — the claim's proof. */
  readonly citation: string;
  readonly fixSummary: string;
}

const SEVERITIES: readonly UxAuditSeverity[] = ['critical', 'high', 'medium', 'low'];

/** The rubric, verbatim from the audit that this loop productizes. */
export function buildUxAuditPrompt(states: readonly UxEvidenceState[]): {
  system: string;
  user: string;
} {
  const system = [
    'You are an end-user simulator reviewing a product you did not build.',
    'For each captured screen you receive its visible text, its controls and',
    'summary geometry. Judge ONE question: does this screen make sense to a',
    'first-time user? Look for: internal jargon shown to users; instructions',
    'that name things which do not exist on any screen; identical-looking',
    'states that mean different things; controls with no discoverable meaning;',
    'numbers that cannot rank anything; large empty viewports.',
    '',
    'Reply with JSON only: {"findings": [{"id": "kebab-slug", "state":',
    '"<state id>", "problem": "<one sentence>", "severity":',
    '"critical|high|medium|low", "citation": "<an EXACT string copied from',
    'that state\'s strings list>", "fixSummary": "<one sentence>"}]}.',
    'The citation must be copied verbatim — findings whose citation does not',
    'appear in the evidence are discarded. An empty findings list is a valid',
    'answer for a screen with no problems.',
  ].join('\n');

  const user = JSON.stringify(
    {
      states: states.map((s) => ({
        id: s.id,
        strings: s.strings,
        controls: (s.interactive ?? []).map((el) => el.name).filter((n) => n !== ''),
        occupancy: s.geometry?.occupancy ?? null,
      })),
    },
    null,
    1,
  );
  return { system, user };
}

/** Validates the parsed model reply into judgments — malformed entries are dropped with a reason, not thrown on. */
export function parseUxAuditJudgments(parsed: Record<string, unknown>): {
  judgments: UxAuditJudgment[];
  malformed: string[];
} {
  const raw = parsed.findings;
  if (!Array.isArray(raw)) return { judgments: [], malformed: ['findings is not an array'] };
  const judgments: UxAuditJudgment[] = [];
  const malformed: string[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      malformed.push(`findings[${index}] is not an object`);
      continue;
    }
    const f = entry as Record<string, unknown>;
    const severity = SEVERITIES.includes(f.severity as UxAuditSeverity)
      ? (f.severity as UxAuditSeverity)
      : undefined;
    if (
      typeof f.id !== 'string' ||
      typeof f.state !== 'string' ||
      typeof f.problem !== 'string' ||
      typeof f.citation !== 'string' ||
      f.citation.trim() === '' ||
      severity === undefined
    ) {
      malformed.push(`findings[${index}] is missing id/state/problem/citation/severity`);
      continue;
    }
    judgments.push({
      id: f.id,
      state: f.state,
      problem: f.problem,
      severity,
      citation: f.citation,
      fixSummary: typeof f.fixSummary === 'string' ? f.fixSummary : '',
    });
  }
  return { judgments, malformed };
}

export interface DroppedJudgment {
  readonly judgment: UxAuditJudgment;
  readonly reason: string;
}

/**
 * The re-grep (C-2/C-3): a citation must appear inside the NAMED state's
 * strings. Substring, not equality — the model may cite a clause of a longer
 * rendered sentence — but always against the one state it named, so a string
 * that exists somewhere else cannot launder a claim about this screen.
 */
export function verifyCitations(
  judgments: readonly UxAuditJudgment[],
  states: readonly UxEvidenceState[],
): { verified: UxAuditJudgment[]; dropped: DroppedJudgment[] } {
  const byId = new Map(states.map((s) => [s.id, s]));
  const verified: UxAuditJudgment[] = [];
  const dropped: DroppedJudgment[] = [];
  for (const judgment of judgments) {
    const state = byId.get(judgment.state);
    if (!state) {
      dropped.push({ judgment, reason: `no captured state named "${judgment.state}"` });
      continue;
    }
    const found = state.strings.some((s) => s.includes(judgment.citation));
    if (!found) {
      dropped.push({
        judgment,
        reason: `citation not present in "${judgment.state}" — a claim the evidence does not contain`,
      });
      continue;
    }
    verified.push(judgment);
  }
  return { verified, dropped };
}

const SEVERITY_RANK: Record<UxAuditSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * A verified judgment as a plans-funnel record shape (the improve loop's
 * vocabulary — which is exactly where "finding"/"severity" is honest, W13-50).
 * The catalog id carries the UX- prefix so a plan row's provenance is legible.
 */
export function judgmentToPlanFields(judgment: UxAuditJudgment): {
  catalogId: string;
  recommendation: string;
  verifyCriterion: string;
  severity: number;
  leverage: number;
  rank: number;
  evidence: Record<string, unknown>;
} {
  const severity = SEVERITY_RANK[judgment.severity];
  // Comprehension defects share one leverage: each blocks understanding of
  // exactly one surface. Severity is where judgments differ.
  const leverage = 2;
  return {
    catalogId: `UX-${judgment.id}`,
    recommendation: `${judgment.problem}${judgment.fixSummary ? ` Fix: ${judgment.fixSummary}` : ''}`,
    verifyCriterion: `re-run the ux-audit: no finding cites "${judgment.citation.slice(0, 80)}"`,
    severity,
    leverage,
    rank: severity * leverage,
    evidence: { state: judgment.state, citation: judgment.citation },
  };
}
