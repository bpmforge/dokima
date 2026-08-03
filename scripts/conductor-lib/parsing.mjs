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
