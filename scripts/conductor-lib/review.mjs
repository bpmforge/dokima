// conductor-lib/review.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.

import { globToRegex } from './parsing.mjs';

export function reviewDecision(verdict) {
  const v = verdict ?? {};
  const findings = Array.isArray(v.findings) ? v.findings : [];
  const priors = Array.isArray(v.prior_status) ? v.prior_status : [];

  const isBlocking = (f) => ['CRITICAL', 'HIGH'].includes(f?.severity);
  const currentHigh = findings.filter(isBlocking);
  const presentPriors = priors.filter((ps) => ps?.status === 'PRESENT');

  const blockers = [
    ...currentHigh.map((f) => `[${f.severity}] ${f.file}: ${f.issue} — fix: ${f.fix}`),
    ...presentPriors.map((ps) => `[STILL-PRESENT] ${ps.finding} — ${ps.evidence || ''}`),
  ];

  return {
    approve: blockers.length === 0,
    blockers,
    currentHigh,
    presentPriors,
    advisory: findings.filter((f) => !isBlocking(f)),
    // True when the reviewer said FIX but raised nothing that blocks — the case
    // that used to spin. Callers log it so the override stays visible.
    verdictOverridden: blockers.length === 0 && v.verdict !== 'APPROVE',
  };
}

/**
 * Select which gates apply to a ticket.
 *
 * A gate entry is either the legacy tuple `[cmd, args]` — always runs — or an
 * object `{cmd, args, when}` where `when` is a list of globs matched against the
 * ticket's write_scope. If none of the ticket's scope entries match, the gate is
 * skipped.
 *
 * Why: running a frontend suite for a backend-only ticket is not extra safety,
 * it is extra failure surface. Kryptkeeper S-32 (write_scope: internal/bootstrap
 * plus tests/smoke, not one ui/ path) failed twice on a flaky `npm --prefix ui
 * test` while a large opengrep scan had the machine at load 155 — a gate it
 * could not possibly have affected, charged to the ticket as a defect. That
 * repo's CLAUDE.md already scopes the ui pair to "tickets touching ui/"; this
 * makes the harness honour the policy the project already states.
 *
 * A skipped gate is returned in `skipped` so the caller can log it — silently
 * running fewer checks than the operator believes is its own hazard.
 */
export function selectGates(gates, ticket, globToRegexFn = globToRegex) {
  const scope = ticket?.write_scope ?? [];
  const run = [];
  const skipped = [];
  for (const g of gates ?? []) {
    if (Array.isArray(g)) { run.push(g); continue; }          // legacy tuple: always
    const entry = [g.cmd, g.args ?? []];
    if (!g.when || !g.when.length) { run.push(entry); continue; }
    const res = g.when.map(globToRegexFn);
    const applies = scope.some((p) => res.some((r) => r.test(p)));
    if (applies) run.push(entry);
    else skipped.push({ cmd: g.cmd, args: g.args ?? [], when: g.when });
  }
  return { run, skipped };
}

/**
 * Lint rule: a ticket that adds a new UI page must also be able to mount it.
 *
 * A page component nothing imports is wired to nothing. In an app with a single
 * route table and a single nav registry, adding `pages/Foo.tsx` without also
 * holding the route file and the nav file produces a component that compiles,
 * ships, and is unreachable by any user.
 *
 * Kryptkeeper hit this twice in one day. W8-04 was filed as
 * [pages/Integrations.tsx] alone and blocked; widened to add App.tsx, nav.ts and
 * lib/api.ts, it landed. W8-07 was then filed the same way and blocked the same
 * way — the earlier fix taught nobody, because it lived in a note instead of a
 * check. Hence this rule.
 *
 * `cfg` shape (null disables): {page, mounts:[...], writes?, writeMounts?:[...]}
 * where `page` matches a new-page path and `mounts` are the files that must
 * accompany it. `writes`/`writeMounts` add a second tier: a page whose
 * acceptance implies mutation also needs the API client, because forking a
 * request helper duplicates whatever auth/tenant headers it centralises.
 */
