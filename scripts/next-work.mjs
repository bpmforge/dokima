#!/usr/bin/env node
// next-work.mjs — what can be worked right now, and why the rest cannot.
//
// WHY THIS EXISTS. `validate-plan`'s P9 prints "Claimable now", and on
// 2026-08-29 it printed exactly one ticket while six were workable. It is not
// wrong — it applies the documented wave rule, where a wave opens only once
// every lower-phase ticket is done — but under that rule the whole remaining
// board sits behind W12-44, a ticket whose own acceptance begins "BLOCKED BY
// DESIGN until a concrete plugin exists to load". So the board's own priority
// signal said "nothing is available" through a session that closed fourteen
// tickets, because P9 is informational and was simply ignored.
//
// A signal that is ignored is worse than no signal: it is the L-47 shape, and
// an unattended loop reading it would stop with work in front of it. This
// answers the question a loop actually has — what should I do next, and if
// nothing, exactly what is in the way — and it separates the two honestly
// rather than collapsing them into one number.
//
// IT DOES NOT REPLACE THE WAVE RULE. P9 still reports strict wave order; this
// reports dependency-readiness, which is what determines whether work can
// physically start. Where they disagree, they disagree visibly, and the
// disagreement is itself information about the plan.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plan = JSON.parse(readFileSync(path.join(ROOT, 'plan.json'), 'utf8'));

/**
 * A blocker a person must clear, stated in the ticket's own words.
 *
 * Matched on phrases this board actually uses, verified against all ten open
 * tickets before being written down: W12-44 says "BLOCKED BY DESIGN", W13-32
 * "DECIDE FIRST, AND RECORD IT", W21-36 "a founder decision, not a cleanup",
 * W21-95 "A FOUNDER DECISION SITS INSIDE THIS". Deliberately narrow — a
 * ticket that merely MENTIONS a decision is not blocked on one, and calling
 * workable work "blocked" is the failure mode that would stall a loop.
 */
const DECISION_MARKERS = [
  [/BLOCKED BY DESIGN/i, 'blocked by design — the ticket says so itself'],
  [/DECIDE FIRST/i, 'the acceptance opens with a decision to record'],
  // \s* on both sides: the board writes both 'a founder decision, not a
  // cleanup' (W21-36, no space before the comma) and 'A FOUNDER DECISION SITS
  // INSIDE THIS' (W21-95). A pattern that assumed one shape read W21-36 as
  // ready — a loop would have picked up a ticket that cannot be finished.
  [/founder decision\s*(sits inside|,?\s*not a)/i, 'a founder decision sits inside the ticket'],
  [/is not a coding question/i, 'the ticket states the risk is not a coding question'],
];

function decisionBlocker(ticket) {
  const text = [
    ticket.title,
    ...(ticket.acceptance ?? []),
    ...(Array.isArray(ticket.notes) ? ticket.notes : []),
  ].join(' ');
  return DECISION_MARKERS.find(([re]) => re.test(text))?.[1] ?? null;
}

const byId = new Map(plan.tickets.map((t) => [t.id, t]));
const open = plan.tickets.filter((t) => t.status !== 'done');

/** How many OPEN tickets are waiting on this one — the reason to do it first. */
function dependentCount(id) {
  return open.filter((t) => (t.depends_on ?? []).includes(id)).length;
}

const rows = open.map((t) => {
  const unmetDeps = (t.depends_on ?? []).filter((d) => byId.get(d)?.status !== 'done');
  const decision = decisionBlocker(t);
  return {
    ticket: t,
    unmetDeps,
    decision,
    // Dependencies come first: a ticket waiting on another cannot start even
    // if someone answers its question.
    state: unmetDeps.length > 0 ? 'waiting' : decision ? 'needs-decision' : 'ready',
    dependents: dependentCount(t.id),
  };
});

const ready = rows
  .filter((r) => r.state === 'ready')
  // Unblocking others first, then smallest — momentum without starving the
  // work that other tickets are waiting on.
  .sort((a, b) => b.dependents - a.dependents || a.ticket.points - b.ticket.points);
const needsDecision = rows.filter((r) => r.state === 'needs-decision');
const waiting = rows.filter((r) => r.state === 'waiting');

const line = (r) =>
  `  ${r.ticket.id.padEnd(8)} ${String(r.ticket.points).padStart(2)}pt  ${r.ticket.lane.padEnd(13)} ${r.ticket.title.slice(0, 62)}`;

console.log(`open: ${open.length}   ready: ${ready.length}   needs a decision: ${needsDecision.length}   waiting on deps: ${waiting.length}`);
console.log('');

if (ready.length > 0) {
  console.log('READY — dependencies satisfied, nothing to ask first:');
  ready.forEach((r) => console.log(line(r)));
  console.log('');
  console.log(`NEXT: ${ready[0].ticket.id}`);
} else {
  console.log('READY: (none) — every open ticket is waiting on a dependency or a decision.');
}
console.log('');

if (needsDecision.length > 0) {
  console.log('NEEDS A DECISION — cannot be honestly finished without an answer:');
  for (const r of needsDecision) {
    console.log(line(r));
    console.log(`             why: ${r.decision}`);
  }
  console.log('');
}

if (waiting.length > 0) {
  console.log('WAITING ON DEPENDENCIES:');
  for (const r of waiting) console.log(`${line(r)}\n             needs: ${r.unmetDeps.join(', ')}`);
  console.log('');
}

// The disagreement with P9 is worth naming rather than hiding: if strict wave
// order says nothing is claimable while dependencies say otherwise, the plan's
// sequencing model and its dependency graph have drifted apart.
const doneIds = new Set(plan.tickets.filter((t) => t.status === 'done').map((t) => t.id));
const waveOpen = (t) =>
  t.phase === 0 ||
  t.module === 'infra' ||
  plan.tickets.every((o) => o.phase >= t.phase || o.module === 'infra' || o.status === 'done');
const waveClaimable = open.filter(
  (t) => t.status === 'todo' && (t.depends_on ?? []).every((d) => doneIds.has(d)) && waveOpen(t),
);
if (waveClaimable.length !== ready.length) {
  console.log(
    `NOTE: strict wave order (validate-plan P9) would allow ${waveClaimable.length} ` +
      `(${waveClaimable.map((t) => t.id).join(', ') || 'none'}), dependency-readiness allows ${ready.length}. ` +
      `The waves and the dependency graph disagree — W21+ are findings waves, filed from live use, ` +
      `and are not sequenced behind older ones.`,
  );
}
