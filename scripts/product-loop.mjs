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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDrivePort, productLoop } from './conductor/product-loop.mjs';
import { loadPlanFrom, writePlan } from './conductor-lib.mjs';
import { ensureBaseline } from './conductor/baseline.mjs';
import { readProductBoard, appendProductTickets } from './conductor/berths-board.mjs';

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
// P6-07: in berths mode the BOARD PLANE is the product's event-log DB — reads
// go straight to listTickets (read-only; C-2 forbids untrusted WRITES, not
// reads), and every write goes through the EXISTING add-ticket verb, never a
// direct DB write. The MEASUREMENT plane (SRS, proving tests, verify receipt)
// stays this repo: the dogfood target is the same product, different board.
const DB_PATH = ENGINE === 'berths' ? String(opt('db', '.dokima.db')) : null;
const AGENT_CMD = opt('agent-command', undefined);
// P6-10: the measurement plane can target ANY repo — SRS/stories, the
// proving-test grep, the verify command, and the board DB all resolve
// against REPO. Defaults unchanged: this repo, CONFIG.verifyCommands.
const REPO = resolve(ROOT, String(opt('repo', '.')));
const VERIFY_CMD = opt('verify-cmd', undefined);
const TARGET_MODE = REPO !== ROOT;
// Challenger F3/F4 (2026-08-31): the cross-plane combos REFUSE. A target
// without its own gate would be judged by THIS repo's cached baseline, and
// the conductor engine reads/writes THIS repo's JSON board — silently
// committing another product's proposals here. Both were proven live.
if (TARGET_MODE && !VERIFY_CMD) {
  console.error(
    '--repo requires --verify-cmd: a target is judged by ITS OWN gate, never by this repo\u2019s baseline',
  );
  process.exit(2);
}
if (TARGET_MODE && ENGINE !== 'berths') {
  console.error(
    "--repo requires --engine berths: the conductor engine drives THIS repo's JSON board only",
  );
  process.exit(2);
}

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
  for (const f of ['docs/SRS.md', 'docs/USER_STORIES.md', 'SRS.md']) {
    const p = resolve(REPO, f);
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
    return sh('git', ['grep', '-l', '--', id, '--', '*.test.*', '*.spec.*'], {
      cwd: REPO,
    })
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
  writeLedger: (l) => {
    // The goal artifact belongs to the MEASURED repo (Challenger F6: target
    // runs were clobbering this repo's tracked ledger).
    const dir = resolve(REPO, 'docs/work');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, 'requirement-ledger.json'),
      JSON.stringify(
        {
          ...l,
          verify_command: VERIFY_CMD ?? '(this repo\u2019s verifyCommands baseline)',
        },
        null,
        2,
      ) + '\n',
    );
  },
  provingTestsFor,
  testExists: (p) => existsSync(resolve(REPO, p)),
  // Target mode: the DB board plane carries no seam model yet — an empty
  // seam set means the seam clause is VACUOUS there, and the ledger's goal
  // line says so (Challenger F6: the demo's "seams resolve" was vacuous).
  seams: () => (TARGET_MODE ? [] : (loadPlanFrom(ROOT, BOARD).seams ?? [])),
  seamResults: () => [], // filled below (async seam assertion)
  verifyMain: () => {
    // P6-10: a target repo brings its OWN gate. One command, run in the
    // target, exit code = the verdict — the receipt is the run itself.
    if (VERIFY_CMD) {
      const r = spawnSync('sh', ['-c', String(VERIFY_CMD)], {
        cwd: REPO,
        encoding: 'utf8',
        timeout: (CONFIG.gateTimeoutMin ?? 30) * 60_000,
      });
      return {
        green: r.status === 0,
        detail:
          r.status === 0
            ? ''
            : `${VERIFY_CMD} exit ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 160)}`,
      };
    }
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
    dbPath: DB_PATH ? resolve(REPO, DB_PATH) : undefined,
    agentCommand: AGENT_CMD,
    spawn: (cmd, args) => {
      if (STATUS_ONLY) return;
      // args[0] is the CLI entry relative to THIS repo; the run executes in
      // the TARGET repo (worktrees, verify, manifest paths are cwd-relative).
      const r = spawnSync(cmd, [resolve(ROOT, args[0]), ...args.slice(1)], {
        cwd: REPO,
        stdio: 'inherit',
      });
      if (ENGINE === 'conductor' && r.status === 3)
        console.error('conductor: blocked_on_baseline — the loop will re-measure');
      else if (r.status !== 0)
        console.error(
          `${ENGINE} engine exited ${r.status ?? 'null'} — the loop re-measures rather than trusts the drive`,
        );
    },
  }),
  log: (kind, data) =>
    console.log(`[${new Date().toISOString()}] ${kind} — ${data.msg ?? ''}`),
};

// Async seam results need a resolved value before the sync loop reads them.
const seamRows = await seamResultsFor(ports.seams());
ports.seamResults = () => seamRows;

// P6-07: berths mode swaps the BOARD plane onto the product DB. The loop's
// readBoard port is sync-shaped, so the async DB read is snapshotted here and
// refreshed after every drive (the core AWAITS runConductor for exactly this).
if (ENGINE === 'berths') {
  const boardCfg = {
    root: REPO,
    dbPath: DB_PATH,
    cliEntry: resolve(ROOT, 'apps/server/src/bootstrap/cli-entry.mjs'),
    spawn: (cmd, args) => spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8' }),
    // The TARGET's gate, never this repo's: a proposal's verify command runs
    // in the target worktree (the engine re-runs it, untrusted).
    verify: TARGET_MODE
      ? VERIFY_CMD // guaranteed by the startup refusal — the TARGET's gate
      : (VERIFY_CMD ?? ((CONFIG.verifyCommands?.[0] ?? []).join(' ') || 'pnpm test')),
  };
  let boardSnapshot = await readProductBoard(boardCfg);
  ports.readBoard = () => boardSnapshot;
  ports.appendTickets = (rows) => {
    for (const msg of appendProductTickets(rows, boardCfg)) console.error(msg);
  };
  const drive = ports.runConductor;
  ports.runConductor = (call) => {
    drive(call);
    // refresh the snapshot after the engine ran, so the next iteration
    // measures the board the engine just changed
    return readProductBoard(boardCfg).then((b) => {
      boardSnapshot = b;
    });
  };
}

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
