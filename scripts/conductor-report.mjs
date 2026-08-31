#!/usr/bin/env node
// conductor-report.mjs — per-UNIQUE-ticket throughput report (P0-03, Law L5).
//
// The 2026-08-31 verification proved event ratios lie: 111 blocked EVENTS /
// 282 start EVENTS read as "39.4% failure" while 128 of 141 unique TICKETS
// (90.8%) actually completed. This report prints both, labeled, with the
// unique-ticket denominator first — and names its window, because a log that
// covers W0-W11 describes the board's first month, not the board.
//
//   node scripts/conductor-report.mjs [--log docs/work/conductor-log.jsonl]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function opt(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/** Pure aggregation over parsed log rows — exported for the fixture test. */
export function aggregate(rows) {
  const kind = (k) => rows.filter((r) => r.kind === k);
  const uniq = (k) => new Set(kind(k).filter((r) => r.ticket).map((r) => r.ticket));
  const started = uniq('ticket.start'), done = uniq('ticket.done'), blocked = uniq('ticket.blocked');
  const recovered = [...blocked].filter((t) => done.has(t));
  const fatals = {};
  for (const r of kind('conductor.fatal')) {
    const key = String(r.msg ?? '').slice(0, 60);
    fatals[key] = (fatals[key] ?? 0) + 1;
  }
  const infra = kind('ticket.infra').length;
  const starts = kind('ticket.start').length || 1;
  const waves = [...new Set([...started].map((t) => (t.match(/^[A-Z]+\d+/) ?? ['?'])[0]))].sort();
  return {
    window: { first: rows[0]?.ts ?? null, last: rows.at(-1)?.ts ?? null, waves },
    uniqueTickets: {
      started: started.size,
      done: done.size,
      everBlocked: blocked.size,
      recoveredAfterBlock: recovered.length,
      stillBlocked: blocked.size - recovered.length,
      completionRate: started.size ? +(done.size / started.size * 100).toFixed(1) : null,
      blockCycleRate: started.size ? +(blocked.size / started.size * 100).toFixed(1) : null,
    },
    perStartEvent: {
      starts: kind('ticket.start').length,
      retries: +(kind('ticket.retry').length / starts).toFixed(2),
      gateFailures: +(kind('gates.fail').length / starts).toFixed(2),
      reviewSessions: +(kind('review.result').length / starts).toFixed(2),
    },
    fatals,
    infraBlocks: infra,
  };
}

export function render(a) {
  const L = [];
  L.push(`window: ${a.window.first ?? '-'} -> ${a.window.last ?? '-'}  waves: ${a.window.waves.join(' ')}`);
  L.push(`  (rates below are for THIS window only — a partial log describes a partial board)`);
  const u = a.uniqueTickets;
  L.push(`unique tickets  started ${u.started} · done ${u.done} (${u.completionRate}%) · ever-blocked ${u.everBlocked} (${u.blockCycleRate}%) · recovered ${u.recoveredAfterBlock} · still blocked ${u.stillBlocked}`);
  const e = a.perStartEvent;
  L.push(`per start event (cost indicators, gameable — never acceptance): retries ${e.retries} · gate-failures ${e.gateFailures} · review-sessions ${e.reviewSessions}`);
  L.push(`infra blocks (charged to nobody): ${a.infraBlocks}`);
  const f = Object.entries(a.fatals).sort((x, y) => y[1] - x[1]);
  L.push(f.length ? `fatals:\n${f.map(([m, n]) => `  ${String(n).padStart(3)}x ${m}`).join('\n')}` : 'fatals: none');
  return L.join('\n');
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const logPath = resolve(ROOT, opt('log', 'docs/work/conductor-log.jsonl'));
  const rows = readFileSync(logPath, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  console.log(render(aggregate(rows)));
}
