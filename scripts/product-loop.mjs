#!/usr/bin/env node
// product-loop.mjs — CLI face of the product goal loop (P5-01).
//
//   node scripts/product-loop.mjs --status            # measure only: ledger + gaps, no writes beyond the ledger
//   node scripts/product-loop.mjs [--max-iterations 5] [--tickets-per-iteration 8]
//
// Wires reality into scripts/conductor/product-loop.mjs's pure core:
// sources = docs/SRS.md + docs/USER_STORIES.md; board = CONFIG.boardPath;
// proving tests found by grepping the id in test/e2e files; verify = the
// cached baseline receipt on HEAD (the SAME trust surface every other gate
// uses); drive = the real conductor as a child process. The loop's exit is
// the assembly gate + a green receipt — done means the product the stories
// describe provably works, not that the board drained.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDrivePort, productLoop } from './conductor/product-loop.mjs';
import { loadPlanFrom, writePlan } from './conductor-lib.mjs';
import { ensureBaseline } from './conductor/baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(resolve(ROOT, 'conductor.config.json'), 'utf8'));
const BOARD = CONFIG.boardPath ?? 'plan.json';

function opt(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0
    ? process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
      ? process.argv[i + 1]
      : true
    : dflt;
}
const STATUS_ONLY = process.argv.includes('--status');
const ENGINE = String(opt('engine', 'conductor')); // conductor|berths — makeDrivePort refuses others

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });

let seamAssert; // lazy, heal-style
async function seamResultsFor(seams) {
  if (!seams.length) return [];
  try {
    seamAssert ??= await import('../packages/pipeline/src/seams/assert.ts');
  } catch {
    return seams.map((s) => ({
      seamId: s.id ?? '?',
      ok: false,
      reason: 'packages/pipeline unavailable — an unchecked seam is not a passed seam',
    }));
  }
  return seamAssert.assertSeams(seams, {
    fileExists: (p) => existsSync(resolve(ROOT, p)),
    readFile: (p) => readFileSync(resolve(ROOT, p), 'utf8'),
  });
}

function readSources() {
  const parts = [];
  for (const f of ['docs/SRS.md', 'docs/USER_STORIES.md']) {
    const p = resolve(ROOT, f);
    if (existsSync(p)) parts.push(readFileSync(p, 'utf8'));
  }
  if (!parts.length) {
    console.error(
      'no docs/SRS.md or docs/USER_STORIES.md — a product loop with no spec has no denominator',
    );
    process.exit(2);
  }
  return parts.join('\n');
}

function provingTestsFor(id) {
  try {
    return sh('git', ['grep', '-l', '--', id, '--', '*.test.*', '*.spec.*', 'e2e/'])
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // no hits
  }
}

const ports = {
  readSources,
  readBoard: () => loadPlanFrom(ROOT, BOARD).tickets,
  appendTickets: (rows) => {
    const plan = loadPlanFrom(ROOT, BOARD);
    for (const r of rows)
      if (!plan.tickets.some((t) => t.id === r.id)) plan.tickets.push(r);
    writePlan(ROOT, plan, BOARD);
    sh('git', ['add', BOARD]);
    sh('git', [
      'commit',
      '-q',
      '-m',
      `chore(product-loop): propose ${rows.map((r) => r.id).join(', ')}`,
    ]);
  },
  writeLedger: (l) =>
    writeFileSync(
      resolve(ROOT, 'docs/work/requirement-ledger.json'),
      JSON.stringify(l, null, 2) + '\n',
    ),
  provingTestsFor,
  testExists: (p) => existsSync(resolve(ROOT, p)),
  seams: () => loadPlanFrom(ROOT, BOARD).seams ?? [],
  seamResults: () => [], // filled below (async seam assertion)
  verifyMain: () => {
    const baseSha = sh('git', ['rev-parse', 'HEAD']).trim();
    const lockfile = resolve(ROOT, 'pnpm-lock.yaml');
    const lockfileHash = existsSync(lockfile)
      ? createHash('sha256').update(readFileSync(lockfile)).digest('hex').slice(0, 16)
      : 'no-lockfile';
    const bl = ensureBaseline({
      baseSha,
      commands: CONFIG.verifyCommands ?? [],
      lockfileHash,
      cacheDir: resolve(ROOT, 'docs/work/baseline-cache'),
      worktreeDir: resolve(ROOT, CONFIG.worktreeDir ?? '../.shipwright-worktrees'),
      timeoutMin: CONFIG.gateTimeoutMin ?? 30,
      git: (a) => sh('git', a).trim(),
      install: (wt) => {
        if (existsSync(resolve(wt, CONFIG.toolchainMarker ?? 'package.json')))
          sh(CONFIG.install?.[0] ?? 'pnpm', CONFIG.install?.[1] ?? ['install'], {
            cwd: wt,
            timeout: 10 * 60_000,
          });
      },
    });
    return { green: bl.green, detail: bl.gaps?.[0]?.split('\n')[0] ?? '' };
  },
  // P6-03: the loop is engine-agnostic — the same runConductor({maxTickets})
  // call drives either the bootstrap harness (conductor) or the PRODUCT's own
  // berths engine (dokima run start), selected once at this seam.
  runConductor: makeDrivePort({
    engine: ENGINE,
    projectId: opt('project-id', undefined),
    berths: Number(opt('berths', 2)),
    spawn: (cmd, args) => {
      if (STATUS_ONLY) return;
      const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
      if (ENGINE === 'conductor' && r.status === 3)
        console.error('conductor: blocked_on_baseline — the loop will re-measure');
    },
  }),
  log: (kind, data) =>
    console.log(`[${new Date().toISOString()}] ${kind} — ${data.msg ?? ''}`),
};

// Async seam results need a resolved value before the sync loop reads them.
const seamRows = await seamResultsFor(ports.seams());
ports.seamResults = () => seamRows;

if (STATUS_ONLY) {
  ports.appendTickets = () => {};
  const r = await productLoop(ports, { maxIterations: 1 });
  console.log(
    r.done
      ? 'PRODUCT PROVEN — every requirement closed, seams resolve, verify green'
      : `NOT DONE — see docs/work/requirement-ledger.json (halt: ${r.halt ?? 'gaps open after 1 measure'})`,
  );
  process.exit(r.done ? 0 : 1);
}

const r = await productLoop(ports, {
  maxIterations: Number(opt('max-iterations', 5)),
  ticketsPerIteration: Number(opt('tickets-per-iteration', 8)),
});
process.exit(r.done ? 0 : r.halt === 'no-progress' ? 3 : 1);
