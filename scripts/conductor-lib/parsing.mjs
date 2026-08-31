// conductor-lib/parsing.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.

// ---------- misc pure helpers ----------
export const wave = (id) => id.split('-')[0];

export const nonWildPrefix = (glob) => glob.replace(/[*?].*$/, '');

export function globToRegex(glob) {
  // '\x01' is a sentinel for '**' chosen before '*' is expanded below, then
  // swapped back — split/join (not a regex literal) so the sentinel never
  // appears inside a RegExp pattern (no-control-regex).
  //
  // W10-53: `**/` must span ZERO OR MORE segments, not one-or-more. This used
  // to expand `a/**/b` to `^a/.*/b$` — the slash after `**` stayed literal, so
  // the pattern required at least one intervening directory. Every standard
  // dialect (bash globstar, minimatch, git pathspec) and validate-plan.mjs's
  // own matcher treat it as zero-or-more, so the ENFORCER was quietly stricter
  // than the board validator that authorised the scope.
  //
  // It bit three times without being noticed: W10-06, W10-28 and W10-30 all
  // scoped `apps/web/src/**/*.css`, which did not cover
  // `apps/web/src/styles.css`, and each worked around it by listing that file
  // explicitly. A boundary narrower than it reads is the dangerous direction
  // here — it teaches operators to widen scopes by hand.
  //
  // The `(?:...)?` wrapper is what makes the separator optional; a bare `.*`
  // would also let `**` match across a segment boundary it should not.
  // `?` is expanded BEFORE the sentinels are joined: the replacement for `**/`
  // contains a literal `?` (the non-capturing `(?:`), and a later blanket
  // `?` -> `[^/]` pass would eat it, producing `([^/]:...)` — silently wrong
  // rather than a syntax error.
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '\x02')
    .replace(/\*\*/g, '\x01')
    .replace(/\*/g, '[^/]*')
    .split('\x02')
    .join('(?:[^/]*\\/)*')
    .split('\x01')
    .join('.*');
  return new RegExp(`^${esc}$`);
}

export function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Decide what a review verdict actually means for the retry loop.
 *
 * Severity policy: only CRITICAL/HIGH findings, plus prior findings the reviewer
 * explicitly marks STILL PRESENT, block a ticket. That policy has a sharp edge —
 * a FIX verdict carrying nothing but MEDIUM/LOW findings produces an EMPTY
 * blocker list. Retrying on an empty list asks the agent to fix nothing, burns a
 * session, and when attempts run out blocks the ticket with an empty ledger:
 * "blocked" with no recorded reason, which is the worst of both outcomes.
 *
 * Observed on Kryptkeeper S-30, 2026-07-29:
 *   review.result  verdict=FIX newHigh=0 priorsStillPresent=0 (sticky-seen 0)
 *   review.fix     0 blocker(s): 0 new + 0 still-present
 *   ticket.retry   attempt 2
 *
 * So: the presence of blockers is the decision, not the verdict string. The
 * reviewer is the authority on whether something blocks; the severity filter is
 * how that authority is expressed. Sub-blocking findings are returned as
 * `advisory` so they are recorded rather than silently dropped.
 */

/**
 * P0-02 (Law L6): classify an executor crash as infrastructure or code.
 *
 * The W0-W11 log's fatal histogram: 15 of 24 fatals were one (since-fixed)
 * executor bug, and of the rest ENOBUFS/ENOSPC/timeouts were environmental —
 * yet every one killed the whole run via main().catch and, worse, could be
 * read as the TICKET's failure. "Never charge the fixer for infrastructure"
 * (FIX_VERIFY_LOOP.md): an infra event blocks the ticket with a named
 * blocked_on_infrastructure reason and the run continues; only a genuine
 * executor defect should stop the process.
 */
const INFRA_PATTERNS = [
  /ENOBUFS/,
  /ENOSPC/,
  /ENOMEM/,
  /EAGAIN/,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /EPIPE/,
  /spawnSync .* ETIMEDOUT/,
  /timed? ?out/i,
  /SIGKILL|SIGTERM/,
  /rate.?limit/i,
  /overloaded/i,
  /529|503/,
];
export function isInfraFailure(err) {
  const msg = String(err?.message ?? err ?? '');
  return INFRA_PATTERNS.some((re) => re.test(msg));
}

/** The gap string an infra event records on the board — greppable class prefix. */
export function infraGap(err) {
  return `blocked_on_infrastructure: ${String(err?.message ?? err).slice(0, 500)} — environmental; consumed no coding attempt (L6)`;
}

/**
 * P2-04 (Law L6): the six terminal states that replace the overloaded
 * `exhausted`. Only the first two consume the feature's implementation retry
 * budget — every other terminal reason names an actor a coding retry cannot
 * substitute for (the repo's base, the machine, the provider, the scope).
 */
export const TERMINAL_STATES = Object.freeze({
  code_attempts_exhausted: { consumesBudget: true },
  review_fix_iterations_exhausted: { consumesBudget: true },
  blocked_on_baseline: { consumesBudget: false },
  blocked_on_infrastructure: { consumesBudget: false },
  provider_attempts_exhausted: { consumesBudget: false },
  blocked_on_scope: { consumesBudget: false },
});

/**
 * Classify why a ticket ended without landing. Deterministic and total: every
 * input maps to exactly one state, most-specific first. `gaps` is the final
 * gap ledger; the flags come from the attempt loop's own bookkeeping.
 */
export function classifyTerminal({
  gaps = [],
  diffClassification = null,
  providerExhausted = false,
  reviewExhausted = false,
  selfBlocked = false,
} = {}) {
  if (providerExhausted) return 'provider_attempts_exhausted';
  if (diffClassification === 'blocked_on_baseline') return 'blocked_on_baseline';
  const text = gaps.join('\n');
  if (/blocked_on_infrastructure/.test(text)) return 'blocked_on_infrastructure';
  if (gaps.length && gaps.every((g) => /^out-of-scope edits:/.test(g)))
    return 'blocked_on_scope';
  if (selfBlocked && /outside .*scope|write[_-]scope|out-of-scope/i.test(text))
    return 'blocked_on_scope';
  if (reviewExhausted) return 'review_fix_iterations_exhausted';
  return 'code_attempts_exhausted';
}

/** Board-note prefix for a terminal state — greppable, budget-honest. */
export function terminalNote(state) {
  const meta = TERMINAL_STATES[state] ?? { consumesBudget: true };
  return `[${state}]${meta.consumesBudget ? '' : ' (consumed no implementation retry budget)'}`;
}
