/**
 * Founder-decision marker syntax (FR-P7: "Phases 3-4 hard-locked while any
 * unresolved founder-decision marker remains"). A marker is an HTML comment
 * sentinel embedded in a blueprint bullet line:
 *
 *   - **Open:** Deployment shape? <!-- FOUNDER-DECISION: deployment-shape UNRESOLVED -->
 *   - **Decided (D-021):** Deployment shape? — self-hosted only <!-- FOUNDER-DECISION: deployment-shape RESOLVED D-021 -->
 *
 * The comment is the only part `parseMarkers` trusts; the surrounding prose
 * (question text, decision summary) is display-only and never inspected by
 * `gate.ts`. One line, not a two-line bullet+comment pair, so resolving a
 * question is a single-line replace (`revision.ts`) with no risk of the
 * prose and the marker drifting apart.
 *
 * Parsing is fail-closed by construction: a line that looks like it's
 * trying to be a marker but doesn't match the strict grammar (typo'd
 * status, missing/garbled comment close, stray whitespace inside the
 * token) is reported as `malformed`, not silently ignored — an
 * unparseable marker must block the gate exactly like a genuine
 * unresolved one, never pass through the cracks.
 */

export const OPEN_QUESTION_KEY_RE = /^[A-Za-z0-9][\w.-]*$/;

export class InvalidOpenQuestionKeyError extends Error {
  constructor(key: string) {
    super(
      `invalid open-question key "${key}" — must match ${OPEN_QUESTION_KEY_RE.source} ` +
        '(alphanumeric, ".", "_", "-" only, starting with an alphanumeric)',
    );
    this.name = 'InvalidOpenQuestionKeyError';
  }
}

export function assertValidOpenQuestionKey(key: string): void {
  if (!OPEN_QUESTION_KEY_RE.test(key)) {
    throw new InvalidOpenQuestionKeyError(key);
  }
}

const STRICT_MARKER_RE =
  /<!-- FOUNDER-DECISION: ([A-Za-z0-9][\w.-]*) (UNRESOLVED|RESOLVED)(?: (D-\d+))? -->/;
const LOOSE_MARKER_RE = /FOUNDER-DECISION/;

export interface UnresolvedMarkerRef {
  readonly key: string;
}

export interface ResolvedMarkerRef {
  readonly key: string;
  readonly decisionId: string;
}

export interface MalformedMarkerRef {
  readonly key: string;
  readonly reason: string;
}

export interface ParsedMarkers {
  readonly unresolved: readonly UnresolvedMarkerRef[];
  readonly resolved: readonly ResolvedMarkerRef[];
  readonly malformed: readonly MalformedMarkerRef[];
}

export function formatUnresolvedMarkerLine(key: string, question: string): string {
  assertValidOpenQuestionKey(key);
  return `- **Open:** ${question} <!-- FOUNDER-DECISION: ${key} UNRESOLVED -->`;
}

export function formatResolvedMarkerLine(
  key: string,
  question: string,
  decisionId: string,
  decisionSummary: string,
): string {
  assertValidOpenQuestionKey(key);
  return (
    `- **Decided (${decisionId}):** ${question} — ${decisionSummary} ` +
    `<!-- FOUNDER-DECISION: ${key} RESOLVED ${decisionId} -->`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex that matches only the marker comment for a specific, already-validated key. */
export function unresolvedMarkerLineRegex(key: string): RegExp {
  assertValidOpenQuestionKey(key);
  return new RegExp(`<!-- FOUNDER-DECISION: ${escapeRegExp(key)} UNRESOLVED -->`);
}

/**
 * Scans every line of `markdown` for founder-decision markers. A key that
 * carries more than one marker line (e.g. a stale UNRESOLVED left behind
 * after a RESOLVED was inserted, rather than replaced) is ambiguous and
 * reported as `malformed`, not folded into either list — an agent
 * re-synthesizing the doc must not be able to "resolve" a question by
 * appending a second marker while leaving the first one intact.
 */
export function parseMarkers(markdown: string): ParsedMarkers {
  const lines = markdown.split('\n');
  const byKey = new Map<
    string,
    Array<{ status: string; decisionId: string | undefined }>
  >();
  const malformed: MalformedMarkerRef[] = [];

  for (const line of lines) {
    const strict = STRICT_MARKER_RE.exec(line);
    if (strict) {
      const key = strict[1];
      const status = strict[2];
      const decisionId = strict[3];
      if (key === undefined || status === undefined) continue;
      const entries = byKey.get(key) ?? [];
      entries.push({ status, decisionId });
      byKey.set(key, entries);
      continue;
    }
    if (LOOSE_MARKER_RE.test(line)) {
      malformed.push({
        key: 'unknown',
        reason: `unparseable founder-decision marker line: ${line.trim()}`,
      });
    }
  }

  const unresolved: UnresolvedMarkerRef[] = [];
  const resolved: ResolvedMarkerRef[] = [];

  for (const [key, entries] of byKey) {
    if (entries.length > 1) {
      malformed.push({
        key,
        reason: `${entries.length} founder-decision markers found for key "${key}" — ambiguous, treated as unresolved`,
      });
      continue;
    }
    const entry = entries[0];
    if (!entry) continue;
    if (entry.status === 'UNRESOLVED') {
      unresolved.push({ key });
    } else if (entry.decisionId) {
      resolved.push({ key, decisionId: entry.decisionId });
    } else {
      malformed.push({ key, reason: `RESOLVED marker for key "${key}" cites no D-ID` });
    }
  }

  return { unresolved, resolved, malformed };
}
