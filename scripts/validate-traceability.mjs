#!/usr/bin/env node
// validate-traceability.mjs — two-way reference-chain validator (design review P4, 2026-07-14).
// Crib: repopulse/scripts/validate-traceability.mjs, adapted to this repo's ID grammar.
// Chain: D (DECISIONS) → S (SCOPE) → FR/NFR (SRS+BLUEPRINT) → US (USER_STORIES) → ticket (plan.json) → doc path.
// HARD FAILURES (exit 1):
//   F1  docs/*.md path referenced in ticket text that neither exists nor is covered by any write_scope glob
//   F2  FR/NFR cited by a ticket (slash-compounds expanded) that is not defined in SRS or BLUEPRINT §6
//   F3  S-x cited in SRS/BLUEPRINT that is not defined in SCOPE
//   F4  D-xxx / P-xxx cited in SCOPE/SRS/CONSTRAINTS that is not defined in DECISIONS
//   F5  ticket.stories[] entry not defined in USER_STORIES
//   F6  FR/NFR cited in a story header that is not defined
// COVERAGE WARNINGS (exit 0; GAP-step input):
//   W1  FR/NFR defined but cited by zero tickets
//   W2  docs/design/*.md never referenced by any ticket text
//   W3  story defined but covered by zero tickets' stories[]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const srs = read('docs/SRS.md');
const blueprint = read('docs/BLUEPRINT.md');
const scope = read('docs/SCOPE.md');
const decisions = read('docs/DECISIONS.md');
const constraints = read('docs/CONSTRAINTS.md');
const stories = read('docs/USER_STORIES.md');
const plan = JSON.parse(read('plan.json'));

// ---- definitions
const FR_DEF_RE = /^(?:\| |- )((?:FR-[A-Z]+|NFR)-?\d+)\b/gm; // "| FR-C1 |" rows, "- FR-C1:" bullets, "| NFR-1 |"
const frDefined = new Set();
for (const src of [srs, blueprint]) for (const m of src.matchAll(FR_DEF_RE)) frDefined.add(m[1].replace(/^NFR-?/, 'NFR-'));
const sDefined = new Set([...scope.matchAll(/^\| (S-\d+)\b/gm)].map((m) => m[1]));
const dDefined = new Set([...decisions.matchAll(/^\| ([DP]-\d{3})\b/gm)].map((m) => m[1]));
const usDefined = new Set([...stories.matchAll(/^### (US-\d{3})\b/gm)].map((m) => m[1]));

// ---- citation extraction
// expands FR-P1/P2, FR-RL1/2, FR-L6\/L7, NFR-1/7 style compounds; tolerates letter-prefixed tails (FR-P1/P2)
function expandFrCitations(text) {
  const out = new Set();
  const RE = /\b(FR-[A-Z]+|NFR)-?(\d+(?:\s*\/\s*[A-Z]*\d+)*)\b/g;
  for (const m of text.matchAll(RE)) {
    for (const part of m[2].split('/')) {
      const num = part.replace(/[^0-9]/g, '');
      if (num) out.add(m[1] === 'NFR' ? `NFR-${num}` : `${m[1]}${num}`);
    }
  }
  return out;
}

const ticketText = (t) => [t.title, ...(t.acceptance ?? []), typeof t.notes === 'string' ? t.notes : ''].join('\n');
const deliverables = plan.tickets.flatMap((t) => t.write_scope ?? []);
const coveredByScope = (p) => deliverables.some((w) => w === p || p.startsWith(w.replace(/\*\*?$/, '')));

const failures = [];
const warnings = [];

const frCitedByTickets = new Set();
for (const t of plan.tickets) {
  const text = ticketText(t);
  // F1 doc paths
  for (const m of text.matchAll(/\bdocs\/[A-Za-z0-9_./-]+\.md\b/g)) {
    const p = m[0];
    if (!existsSync(join(root, p)) && !coveredByScope(p)) failures.push(`F1 ${t.id}: missing doc ${p}`);
  }
  // F2 FR citations
  for (const fr of expandFrCitations(text)) {
    frCitedByTickets.add(fr);
    if (!frDefined.has(fr)) failures.push(`F2 ${t.id}: undefined requirement ${fr}`);
  }
  // F5 stories
  for (const s of t.stories ?? []) if (!usDefined.has(s)) failures.push(`F5 ${t.id}: undefined story ${s}`);
}

// F3 S-x cited in SRS/BLUEPRINT
for (const src of [srs, blueprint]) for (const m of src.matchAll(/\b(S-\d+)\b/g)) if (!sDefined.has(m[1])) failures.push(`F3 undefined scope item ${m[1]} cited in SRS/BLUEPRINT`);
// F4 D/P cited in SCOPE/SRS/CONSTRAINTS
for (const src of [scope, srs, constraints]) for (const m of src.matchAll(/\b([DP]-\d{3})\b/g)) if (!dDefined.has(m[1])) failures.push(`F4 undefined decision ${m[1]}`);
// F6 story-header FR citations + story→ticket coverage
const storyHeaderRe = /^### (US-\d{3}) .*?—\s*\d+ pts?\s*—\s*(.+)$/gm;
const storyFr = new Map();
for (const m of stories.matchAll(storyHeaderRe)) {
  const frs = expandFrCitations(m[2]);
  storyFr.set(m[1], frs);
  for (const fr of frs) if (!frDefined.has(fr) && !/^D-\d+/.test(fr)) failures.push(`F6 ${m[1]}: undefined requirement ${fr}`);
}

// W1 uncited FRs
for (const fr of [...frDefined].sort()) if (!frCitedByTickets.has(fr)) warnings.push(`W1 ${fr} defined but cited by zero tickets`);
// W2 design docs unreferenced
const allTicketText = plan.tickets.map(ticketText).join('\n');
for (const f of readdirSync(join(root, 'docs/design'))) {
  if (!f.endsWith('.md')) continue;
  if (!allTicketText.includes(`docs/design/${f}`)) warnings.push(`W2 docs/design/${f} never referenced by any ticket`);
}
// W3 uncovered stories
const covered = new Set(plan.tickets.flatMap((t) => t.stories ?? []));
for (const us of [...usDefined].sort()) if (!covered.has(us)) warnings.push(`W3 ${us} covered by zero tickets`);

// ---- report
const dedupF = [...new Set(failures)];
const dedupW = [...new Set(warnings)];
console.log(`Inventory: ${frDefined.size} FR/NFR defined · ${frCitedByTickets.size} cited by tickets · ${sDefined.size} S-items · ${dDefined.size} D/P-decisions · ${usDefined.size} stories (${covered.size} distinct ticket-covered)`);
if (dedupW.length) {
  console.log(`Coverage gaps (${dedupW.length}) — GAP-step input, not failures:`);
  for (const w of dedupW) console.log('  - ' + w);
}
if (dedupF.length) {
  console.error(`FAIL: ${dedupF.length} dangling reference(s):`);
  for (const f of dedupF) console.error('  - ' + f);
  process.exit(1);
}
console.log('OK: traceability chain has no dangling references.');
