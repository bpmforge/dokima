#!/usr/bin/env node
// validate-plan.mjs — plan.json schema/graph validator (design review P4, 2026-07-14).
// Crib: repopulse/scripts/validate-plan.mjs, adapted to this board's schema.
// Rules (stable IDs):
//   P1  plan.version === 1; tickets non-empty array
//   P2  fixed key set per ticket (TICKET_KEYS required; OPTIONAL_KEYS allowed; unknown keys fail)
//   P3  id matches /^W\d-\d{2}[a-c]?$/; unique; phase === wave prefix
//   P4  title non-empty; module ∈ MODULES; lane ∈ LANES; status ∈ STATUSES; points ∈ POINTS
//   P5  write_scope non-empty array of non-empty globs; acceptance 1–6 non-empty strings
//       (house deviation from repopulse's 2–5: several landed single-criterion tickets)
//   P6  stories[] entries match /^US-\d{3}$/ (may be empty for infra/harness tickets)
//   P7  deps: exist, no self-dep, no forward-wave dep (unless in FORWARD_DEP_EXCEPTIONS), no cycles
//   P8  lane law (D-015): cross-lane write-scope overlap is an error among tickets that can
//       still write (status !== 'done'), unless a ticket declares "scaffold": true;
//       same-lane overlap is an error only among concurrently-active (in_progress) tickets
//   P9  wave gating report: per-wave counts + claimable set (informational)
// Exit 1 on any violation; prints the violation list. Exit 0 prints OK + report.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'));

const MODULES = ['infra', 'shared', 'events', 'tickets', 'loop', 'validators', 'gateway', 'harbormaster', 'pipeline', 'git', 'forge', 'mcp', 'memory', 'content', 'cli', 'web', 'quality'];
const LANES = ['infra', 'core', 'engine', 'gateway', 'orchestrator', 'ui', 'pipeline', 'integrations', 'memory', 'content', 'quality'];
const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const POINTS = [1, 2, 3, 5, 8];
const TICKET_KEYS = ['id', 'title', 'phase', 'module', 'lane', 'write_scope', 'depends_on', 'acceptance', 'points', 'status', 'notes', 'stories'];
const OPTIONAL_KEYS = ['scaffold'];
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
  if (!/^W\d-\d{2}[a-c]?$/.test(t.id ?? '')) { err(`P3 ${label}: bad id`); continue; }
  if (ids.has(t.id)) err(`P3 ${t.id}: duplicate id`);
  ids.add(t.id);
  if (t.phase !== Number(t.id[1])) err(`P3 ${t.id}: phase ${t.phase} != wave prefix`);
  if (!t.title) err(`P4 ${t.id}: empty title`);
  if (!MODULES.includes(t.module)) err(`P4 ${t.id}: module ${t.module}`);
  if (!LANES.includes(t.lane)) err(`P4 ${t.id}: lane ${t.lane}`);
  if (!STATUSES.includes(t.status)) err(`P4 ${t.id}: status ${t.status}`);
  if (!POINTS.includes(t.points)) err(`P4 ${t.id}: points ${t.points}`);
  if (!Array.isArray(t.write_scope) || t.write_scope.length === 0 || t.write_scope.some((g) => !g)) err(`P5 ${t.id}: write_scope`);
  if (!Array.isArray(t.acceptance) || t.acceptance.length < 1 || t.acceptance.length > 6 || t.acceptance.some((a) => !a)) err(`P5 ${t.id}: acceptance (need 1-6 non-empty)`);
  if (!Array.isArray(t.stories) || t.stories.some((s) => !/^US-\d{3}$/.test(s))) err(`P6 ${t.id}: stories`);
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
if (errors.length) {
  console.error(`FAIL: ${errors.length} violation(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('OK: plan.json is valid.');
