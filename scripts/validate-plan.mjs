#!/usr/bin/env node
// validate-plan.mjs — plan.json schema/graph validator (design review P4, 2026-07-14).
// Crib: repopulse/scripts/validate-plan.mjs, adapted to this board's schema.
// Rules (stable IDs):
//   P1  plan.version === 1; tickets non-empty array
//   P2  fixed key set per ticket (TICKET_KEYS required; OPTIONAL_KEYS allowed; unknown keys fail)
//   P3  id matches /^W\d+-\d{2}[a-c]?$/; unique; phase === wave prefix
//        (\d+, not \d: waves reached double digits at W10. The old single-digit
//         regex would have rejected every W10 ticket, and `Number(t.id[1])`
//         read one character, so W10-01 parsed as phase 1.)
//   P4  title non-empty; module ∈ MODULES; lane ∈ LANES; status ∈ STATUSES; points ∈ POINTS
//   P5  write_scope non-empty array of non-empty globs; acceptance 1–6 non-empty strings
//       (house deviation from repopulse's 2–5: several landed single-criterion tickets)
//   P6  stories[] entries match /^US-\d{3}$/ (may be empty for infra/harness tickets)
//   P7  deps: exist, no self-dep, no forward-wave dep (unless in FORWARD_DEP_EXCEPTIONS), no cycles
//   P8  lane law (D-015): cross-lane write-scope overlap is an error among tickets that can
//       still write (status !== 'done'), unless a ticket declares "scaffold": true;
//       same-lane overlap is an error only among concurrently-active (in_progress) tickets
//   P9  wave gating report: per-wave counts + claimable set (informational)
//   P11 optional `role` names an expert that exists in content/experts (D-025),
//       is not a verifier role (C-4), and fails BY NAME rather than falling
//       back to coding-agent — a typo that silently routes to the default is
//       the whole defect this field was added to fix
//   P13 REPORT ONLY (never fails): a note that defers work to a later ticket
//        while naming no ticket id — the work that gets promised and dropped.
//   P12 REPORT ONLY (never fails): acceptance criteria that name a rendered UI
//        surface on a ticket whose write_scope cannot reach apps/web. See the
//        block at the bottom for the measurement that decided report-vs-fail.
//   P10 ARCHITECTURE.md §4 dependency matrix must agree, row for row, with each
//       row-package's declared `@dokima/*` dependencies (dependencies field only) —
//       exact-set match, not just "no forbidden import": the matrix is a live
//       record of what's declared, not an aspirational ceiling nobody enforces
//       (W11-05). A package growing into a new import updates package.json AND
//       this matrix in the same change, or P10 fails.
// Exit 1 on any violation; prints the violation list. Exit 0 prints OK + report.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'));

const MODULES = ['infra', 'shared', 'events', 'tickets', 'loop', 'validators', 'gateway', 'harbormaster', 'pipeline', 'git', 'forge', 'mcp', 'memory', 'content', 'cli', 'web', 'quality'];
const LANES = ['infra', 'core', 'engine', 'gateway', 'orchestrator', 'ui', 'pipeline', 'integrations', 'memory', 'content', 'quality'];
const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'parked'];
const POINTS = [1, 2, 3, 5, 8];
const TICKET_KEYS = ['id', 'title', 'phase', 'module', 'lane', 'write_scope', 'depends_on', 'acceptance', 'points', 'status', 'notes', 'stories'];
const OPTIONAL_KEYS = ['scaffold', 'role'];

/**
 * P11 (D-025, W12-06): the expert a ticket names must be one that exists.
 *
 * Read from `content/experts/**` rather than hardcoded, because a hardcoded
 * list drifts from the pack the moment it is re-imported — and a role that
 * quietly falls back to `coding-agent` is the silent-degradation class this
 * wave keeps finding. The file STEM is the role: that is not a convention
 * invented here, it is what `apps/server/src/api/roster-resolve.ts` documents
 * and what the gateway matrix routes on.
 *
 * ALL-CAPS stems are excluded. `content/experts/` also holds methodology and
 * schema documents (METHODOLOGY, FINDINGS_SCHEMA, PARALLEL_WAVE_PROTOCOL) that
 * are reference material for experts, not experts — without this the validator
 * would happily accept `role: "METHODOLOGY"`. The pack's own naming convention
 * is the discriminator, so this narrows on the convention rather than on a
 * hand-kept exception list that would drift at the next import.
 */
function expertRoles(dir) {
  const roles = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const r of expertRoles(join(dir, entry.name))) roles.add(r);
    } else if (entry.name.endsWith('.md')) {
      const stem = entry.name.slice(0, -3);
      if (stem !== stem.toUpperCase()) roles.add(stem);
    }
  }
  return roles;
}

let EXPERT_ROLES;
try {
  EXPERT_ROLES = expertRoles(join(root, 'content', 'experts'));
} catch {
  // No pack on disk (a checkout without `content/`): the field cannot be
  // validated, and inventing a whitelist would be worse than saying so.
  EXPERT_ROLES = null;
}

/**
 * A maker may not be its own verifier (C-4, CLAUDE.md law 5). `code-reviewer`
 * and `challenger` are real experts in the pack, so the roster check alone
 * would accept them here — this is the reason the board refuses them as a
 * ticket's `role`, and `defaultHandoffBuilder` refuses them again at dispatch.
 */
const VERIFIER_ROLES = ['code-reviewer', 'challenger'];
const FORWARD_DEP_EXCEPTIONS = new Set([]);

const errors = [];
const err = (m) => errors.push(m);

// ---- P1
if (plan.version !== 1 && plan.version !== undefined) err(`P1 plan.version is ${plan.version}`);
if (!Array.isArray(plan.tickets) || plan.tickets.length === 0) {
  console.error('FATAL P1: plan.tickets missing/empty');
  process.exit(1);
}
const T = plan.tickets;

// ---- glob overlap (same dialect as packages/tickets/src/lanes.ts — keep in sync; W3-12 consolidates)
function segmentTextOverlaps(a, b) {
  const memo = new Map();
  const go = (i, j) => {
    const k = i + ':' + j;
    if (memo.has(k)) return memo.get(k);
    let r;
    if (i === a.length && j === b.length) r = true;
    else if (i < a.length && a[i] === '*') r = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === '*') r = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else if (i < a.length && j < b.length && (a[i] === '?' || b[j] === '?' || a[i] === b[j])) r = go(i + 1, j + 1);
    else r = false;
    memo.set(k, r);
    return r;
  };
  return go(0, 0);
}
function segmentListOverlaps(as, bs) {
  const memo = new Map();
  const go = (i, j) => {
    const k = i + ':' + j;
    if (memo.has(k)) return memo.get(k);
    let r;
    if (i === as.length && j === bs.length) r = true;
    else if (i < as.length && as[i] === '**') r = go(i + 1, j) || (j < bs.length && go(i, j + 1));
    else if (j < bs.length && bs[j] === '**') r = go(i, j + 1) || (i < as.length && go(i + 1, j));
    else if (i < as.length && j < bs.length && segmentTextOverlaps(as[i], bs[j])) r = go(i + 1, j + 1);
    else r = false;
    memo.set(k, r);
    return r;
  };
  return go(0, 0);
}
const globOverlaps = (a, b) => segmentListOverlaps(a.split('/'), b.split('/'));
const scopesOverlap = (a, b) => a.some((x) => b.some((y) => globOverlaps(x, y)));

// ---- per ticket P2–P6
const ids = new Set();
for (const t of T) {
  const label = t.id ?? '<no id>';
  for (const k of TICKET_KEYS) if (!(k in t)) err(`P2 ${label}: missing key ${k}`);
  for (const k of Object.keys(t)) if (!TICKET_KEYS.includes(k) && !OPTIONAL_KEYS.includes(k)) err(`P2 ${label}: unknown key ${k}`);
  const idMatch = /^W(\d+)-\d{2}[a-c]?$/.exec(t.id ?? '');
  if (!idMatch) { err(`P3 ${label}: bad id`); continue; }
  if (ids.has(t.id)) err(`P3 ${t.id}: duplicate id`);
  ids.add(t.id);
  if (t.phase !== Number(idMatch[1])) err(`P3 ${t.id}: phase ${t.phase} != wave prefix`);
  if (!t.title) err(`P4 ${t.id}: empty title`);
  if (!MODULES.includes(t.module)) err(`P4 ${t.id}: module ${t.module}`);
  if (!LANES.includes(t.lane)) err(`P4 ${t.id}: lane ${t.lane}`);
  if (!STATUSES.includes(t.status)) err(`P4 ${t.id}: status ${t.status}`);
  if (!POINTS.includes(t.points)) err(`P4 ${t.id}: points ${t.points}`);
  if (!Array.isArray(t.write_scope) || t.write_scope.length === 0 || t.write_scope.some((g) => !g)) err(`P5 ${t.id}: write_scope`);
  if (!Array.isArray(t.acceptance) || t.acceptance.length < 1 || t.acceptance.length > 6 || t.acceptance.some((a) => !a)) err(`P5 ${t.id}: acceptance (need 1-6 non-empty)`);
  if (!Array.isArray(t.stories) || t.stories.some((s) => !/^US-\d{3}$/.test(s))) err(`P6 ${t.id}: stories`);
  if ('role' in t) {
    if (typeof t.role !== 'string' || t.role === '') err(`P11 ${t.id}: role must be a non-empty string`);
    else if (VERIFIER_ROLES.includes(t.role)) err(`P11 ${t.id}: role ${t.role} is a verifier role — a maker may not be its own verifier (C-4)`);
    else if (EXPERT_ROLES && !EXPERT_ROLES.has(t.role)) err(`P11 ${t.id}: role ${t.role} is not an expert in content/experts`);
  }
}

// ---- P7 deps
const by = Object.fromEntries(T.map((t) => [t.id, t]));
for (const t of T) {
  for (const d of t.depends_on ?? []) {
    if (d === t.id) err(`P7 ${t.id}: self-dependency`);
    else if (!by[d]) err(`P7 ${t.id}: unknown dep ${d}`);
    else if (by[d].phase > t.phase && !FORWARD_DEP_EXCEPTIONS.has(`${t.id}->${d}`)) err(`P7 ${t.id}: forward-wave dep ${d}`);
  }
}
{
  const color = new Map();
  const dfs = (id, path) => {
    color.set(id, 'gray');
    for (const d of by[id]?.depends_on ?? []) {
      if (!by[d]) continue;
      if (color.get(d) === 'gray') err(`P7 cycle: ${[...path, id, d].join(' -> ')}`);
      else if (!color.has(d)) dfs(d, [...path, id]);
    }
    color.set(id, 'black');
  };
  for (const t of T) if (!color.has(t.id)) dfs(t.id, []);
}

// ---- P8 lane law (D-015)
for (let i = 0; i < T.length; i++) {
  for (let j = i + 1; j < T.length; j++) {
    const a = T[i]; const b = T[j];
    if (!scopesOverlap(a.write_scope, b.write_scope)) continue;
    if (a.lane !== b.lane) {
      if (a.status === 'done' || b.status === 'done') continue; // territory released (D-015)
      if (a.scaffold === true || b.scaffold === true) continue; // declared exemption (D-015)
      err(`P8 cross-lane overlap: ${a.id}(${a.lane}) x ${b.id}(${b.lane})`);
    } else if (a.status === 'in_progress' && b.status === 'in_progress') {
      err(`P8 same-lane active overlap: ${a.id} x ${b.id} (${a.lane})`);
    }
  }
}

// ---- P9 report
const waves = {};
for (const t of T) {
  const w = 'W' + t.phase;
  waves[w] ??= { total: 0, pts: 0, done: 0, todo: 0, blocked: 0, in_progress: 0 };
  waves[w].total++; waves[w].pts += t.points; waves[w][t.status]++;
}
const doneIds = new Set(T.filter((t) => t.status === 'done').map((t) => t.id));
const waveOpen = (t) => t.phase === 0 || t.module === 'infra' || T.every((o) => o.phase >= t.phase || o.module === 'infra' || o.status === 'done');
const claimable = T.filter((t) => t.status === 'todo' && (t.depends_on ?? []).every((d) => doneIds.has(d)) && waveOpen(t)).map((t) => t.id).sort();

console.log(`Inventory: ${T.length} tickets · ${T.reduce((a, x) => a + x.points, 0)} pts · ` + Object.entries(waves).sort().map(([w, v]) => `${w} ${v.done}/${v.total}`).join(' · '));
console.log(`Claimable now: ${claimable.join(', ') || '(none)'}`);

// ---- P10 ARCHITECTURE.md §4 matrix vs each package's declared @dokima/* deps
{
  const archPath = join(root, 'docs', 'ARCHITECTURE.md');
  const archLines = readFileSync(archPath, 'utf8').split('\n');
  const headingIdx = archLines.findIndex((l) => l.startsWith('### Declared-dependency matrix'));
  const splitRow = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  if (headingIdx === -1) {
    err('P10: docs/ARCHITECTURE.md "### Declared-dependency matrix" heading not found');
  } else {
    const tableLines = [];
    for (let i = headingIdx + 1; i < archLines.length; i++) {
      const l = archLines[i];
      if (l.trim().startsWith('|')) tableLines.push(l);
      else if (tableLines.length) break;
    }
    // tableLines[0] = header ('imports →' + column names), [1] = '---' separator, [2..] = data rows
    const columns = splitRow(tableLines[0]).slice(1);
    const pkgJsonPathFor = (rowName) => (rowName.startsWith('apps/') ? rowName : `packages/${rowName}`);
    for (const line of tableLines.slice(2)) {
      const cells = splitRow(line);
      const rowName = cells[0].replace(/\*\*/g, '').trim();
      const dataCells = cells.slice(1);
      const allowed = new Set();
      for (const m of line.matchAll(/\(\+([\w-]+)\)/g)) allowed.add(m[1]); // e.g. "✅ (+harbormaster)"
      dataCells.forEach((cell, idx) => { if (cell.includes('✅')) allowed.add(columns[idx]); });
      const pkgJsonPath = join(root, pkgJsonPathFor(rowName), 'package.json');
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      } catch {
        err(`P10 ${rowName}: cannot read ${pkgJsonPathFor(rowName)}/package.json`);
        continue;
      }
      const declared = new Set(
        Object.keys(pkg.dependencies ?? {})
          .filter((d) => d.startsWith('@dokima/'))
          .map((d) => d.replace('@dokima/', '')),
      );
      const missing = [...allowed].filter((d) => !declared.has(d)).sort();
      const extra = [...declared].filter((d) => !allowed.has(d)).sort();
      if (missing.length) err(`P10 ${rowName}: matrix allows but package.json dependencies omit: ${missing.join(', ')}`);
      if (extra.length) err(`P10 ${rowName}: package.json dependencies declare but matrix forbids: ${extra.join(', ')}`);
    }
  }
}

// ---- P13 deferred work that named no ticket: a REPORT (2026-08-29)
/**
 * A note that says "worth a follow-up" or "its own ticket" and names none.
 *
 * FOUND BY BEING CAUGHT. Across one long session I deferred work in ticket
 * notes five times — cross-run gate evidence (W21-73), deliverable tickets
 * beyond phase 0 (W21-76), the e2e teardown retry (W21-77), the Decide-card
 * half of the rejection notice (W21-90), the first real @unreached marker
 * (W22-02) — and filed none of them. Every one was written down honestly, in
 * the right place, and still lost, because writing it down was the last thing
 * that happened to it. The founder asked what was watching for that. Nothing
 * was.
 *
 * MEASURED before wiring, as P12 and W22-09 both were: 17 deferral-shaped
 * notes across the whole board, 7 naming an existing ticket and 10 not. Hand
 * reading the 10, roughly half are genuine unfiled work and the rest are scope
 * or closure notes that merely read like deferrals. ~50% is far better than
 * P12's 13% and still not a gate — a validator wrong half the time teaches
 * people to skim it (D-014, W21-38). So it reports.
 *
 * THE CHEAP ANSWER IS ALSO THE RIGHT ONE: name the ticket in the note. A
 * deferral that says "filed as W22-10" is both a better note and invisible to
 * this check, which is the incentive it should create.
 */
{
  const DEFER =
    /\b(worth (its own |a )?(ticket|follow-?up)|its own ticket|needs its own ticket|filed (separately|as its own)|a follow-?up|left for (a|its own) (ticket|follow-?up))\b/i;
  // A CARRIER IS OPEN WORK. Referencing a done ticket is history — this
  // repo's notes cite W-ids constantly, so "mentions any ticket" matched
  // almost everything and the check reported ZERO, which is the L-47 failure
  // it was written to prevent. Only a ticket that can still be worked can
  // carry a deferral.
  const carriers = new Set(T.filter((t) => t.status !== 'done').map((t) => t.id));
  const notes = [];
  // DONE TICKETS INCLUDED, and that is the point: a deferral is made at CLOSE
  // time — "this half is a follow-up" is the last thing written before a
  // ticket stops being looked at. Skipping done tickets would skip every case.
  for (const t of T) {
    // Not every ticket stores notes as an array — guard rather than assume.
    const all = (Array.isArray(t.notes) ? t.notes : []).filter((n) => typeof n === 'string');
    // PER TICKET, not per note. A deferral recorded in one note and its
    // carrier named in another is exactly how a ticket SHOULD read, and an
    // earlier draft of this check reported all five of the ones I had just
    // filed carriers for — a validator that cannot see the fix it asked for.
    const refs = all.join(' ').match(/\bW\d+-\d{2}[a-c]?\b/g) ?? [];
    if (refs.some((r) => r !== t.id && carriers.has(r))) continue;
    const deferral = all.find((n) => DEFER.test(n));
    if (deferral === undefined) continue;
    notes.push(`${t.id} defers work and names no ticket for it\n      note: ${deferral.slice(0, 150)}`);
  }
  if (notes.length) {
    console.log(`REPORT: P13 (${notes.length}) — work deferred in a note with no ticket to carry it:`);
    for (const n of notes) for (const line of ('- ' + n).split('\n')) console.log('REPORT-CONT: ' + line);
    console.log('REPORT-CONT: (report only; file it, or name the ticket that already carries it)');
  }
}

// ---- P12 acceptance-vs-write_scope: a REPORT, deliberately not a failure (W22-03)
/**
 * Catches the shape that cost this board six claims: a ticket whose acceptance
 * requires a rendered surface to change, scoped to packages that cannot reach
 * `apps/web`. W21-89 needed the Settings panel from a server-only scope; W21-90
 * needs the Decide card from a harbormaster scope; W21-96 says the timeout is
 * "settable from the Providers panel" while scoped to two route files.
 *
 * WHY THIS PRINTS INSTEAD OF FAILING — measured, not assumed. The ticket asked
 * for a refusal at filing time. The data says a refusal would be wrong:
 *
 *   - Inferring a required path from prose: 92 hits across the whole plan,
 *     essentially ALL references rather than write targets ("MEASURED: four
 *     files exceed the cap — <list>", "calls redactDeep (packages/shared/...)").
 *   - This widget lexicon, unfiltered: 44 hits on tickets that SHIPPED fine
 *     with server-only scope. Hand-sampling 25 of them found 1 genuine
 *     mismatch — roughly 4% precision.
 *   - With the length cap below: 15 retrospective hits, 2 genuine. ~13%.
 *
 * A validator that is wrong six times out of seven teaches people to ignore it,
 * which is the failure D-014 and W21-38 both warn about and the exact reason
 * this ticket's own third criterion says silence beats a false positive. So it
 * reports, in the manner of P9's wave report, and `pnpm validate` (Law 3) puts
 * that report in front of a human on every gate run.
 *
 * ONE-DIRECTIONAL ON PURPOSE: it catches a non-web scope that needs the web,
 * never a web scope that needs the server. The reverse has no comparable
 * lexicon — server surfaces are not named with a shared vocabulary of nouns.
 *
 * The length cap is not arbitrary: criteria over ~200 characters in this plan
 * are evidence narrative ("MEASURED 2026-08-03: …"), which mentions surfaces
 * in passing. Real criteria are terse.
 */
{
  // Unambiguously-rendered widgets only. Deliberately NOT "board", "view",
  // "screen" or "page": all four are domain nouns here — "the board" is the
  // ticket graph, not only its rendering.
  const WIDGETS = ['card', 'cards', 'panel', 'drawer', 'banner', 'wizard', 'button', 'dialog', 'modal', 'tooltip', 'checkbox', 'dropdown', 'toggle'];
  const WIDGET_RE = new RegExp(`\\b(${WIDGETS.join('|')})\\b`, 'i');
  const MAX_CRITERION_LEN = 200;
  const notes = [];
  for (const t of T) {
    if (t.status === 'done') continue;
    if ((t.write_scope ?? []).some((g) => g.startsWith('apps/web/'))) continue;
    for (const a of t.acceptance ?? []) {
      if (a.length > MAX_CRITERION_LEN) continue;
      const m = WIDGET_RE.exec(a);
      if (!m) continue;
      notes.push(`${t.id} names a "${m[1]}" but no write_scope entry reaches apps/web/\n      criterion: ${a}`);
    }
  }
  if (notes.length) {
    // REPORT:/REPORT-CONT: is the contract run-validators.mjs forwards from a
    // PASSING validator. Without the prefix this prints into a void under
    // `pnpm validate`, which is the only place Law 3 runs it.
    console.log(`REPORT: P12 (${notes.length}) — acceptance names a UI surface the write_scope cannot reach:`);
    for (const n of notes) for (const line of ('- ' + n).split('\n')) console.log('REPORT-CONT: ' + line);
    console.log('REPORT-CONT: (report only; widen the scope, reword the criterion, or ignore if the surface already exists)');
  }
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} violation(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('OK: plan.json is valid.');
