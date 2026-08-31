#!/usr/bin/env node
/**
 * conductor.mjs — unattended, reusable ticket executor for a board file
 * (default plan.json at the repo root; W9-10: override via conductor.config.json's
 * `boardPath` for a repo whose board lives elsewhere, e.g. docs/board/plan.json).
 *
 * The M28 Conductor pattern: THE CONDUCTOR HOLDS THE GATES, NOT THE AGENTS.
 * Each ticket runs in a fresh `claude -p` session inside its OWN git worktree
 * (isolated tree + branch); this script verifies everything from outside the
 * session (gates, write-scope, commits, board state), runs an independent
 * review with sticky findings (maker ≠ verifier), and only then merges. It
 * survives provider limits (sleep-to-reset) and its own crashes (supervise.sh).
 *
 * Project-specific settings live in conductor.config.json — the script itself
 * is repo-agnostic. Model routing lives in conductor.config.json's `models`
 * key (see DEFAULT_CONFIG.models in conductor-lib.mjs for the built-in
 * default ladder used when a project omits it).
 *
 * IMPORT SURFACE (W9-12): dropping this conductor into another repo needs
 * exactly TWO vendored files — conductor.mjs (this file) and
 * conductor-lib.mjs — plus that repo's own conductor.config.json at its
 * root. Nothing else is read unconditionally at import time: boardPath
 * (W9-10) and models (W9-12) both live in conductor.config.json and fall
 * back to built-in defaults (DEFAULT_CONFIG in conductor-lib.mjs) when the
 * config omits them or the config file itself is absent.
 *
 *   node scripts/conductor.mjs [--waves W0,W1] [--breakpoint ticket|wave|never]
 *     [--max-tickets N] [--session-minutes 45] [--no-merge] [--no-push]
 *     [--dry-run] [--escalate] [--lint]
 *
 * --lint          validate the board (CONFIG.boardPath) and exit (also runs automatically at start)
 * Stop any time:  `touch STOP` in the repo root (checked between sessions).
 */
//
// W10-46: this file was 715 lines, over the 400-line CODE_BOOK_PROTOCOL cap.
// With conductor-lib.mjs it was also the reason validate-file-size could not be
// flipped repo-wide (W10-40) — it IS the machinery that runs the gate, so
// enabling the gate would have failed every ticket including the one fixing it.
// The implementation now lives in scripts/conductor/ chapters; this file is the
// entry point and the run loop. It stays at this exact path because
// scripts/supervise.sh and both test suites invoke it by name, and ESM has no
// directory-index resolution.

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { nodePinMismatch, wave, isInfraFailure, infraGap } from './conductor-lib.mjs';
import {
  ROOT,
  CONFIG,
  MODELS,
  STOPFILE,
  BREAKPOINT,
  WAVES,
  MAX_TICKETS,
  DRY,
  DO_MERGE,
  LINT_ONLY,
  log,
  sh,
  git,
  loadPlan,
  claimable,
  pickModel,
} from './conductor/context.mjs';
import { lintPlan } from './conductor/lint.mjs';
import { executeTicket } from './conductor/ticket.mjs';
import { land, markBlocked, parkForSplit } from './conductor/land.mjs';
import { tryFeatureLandings } from './conductor/feature-landing-wiring.mjs';
import { waveSecurityPass } from './conductor/security.mjs';
import { ensureBaseline } from './conductor/baseline.mjs';

// ---------- main ----------
async function main() {
  // plan lint — always, and exit early on --lint
  const { errors, warnings } = lintPlan(loadPlan());
  for (const w of warnings) log('lint.warn', { msg: w });
  if (errors.length) {
    for (const e of errors) log('lint.error', { msg: e });
    if (!DRY) {
      console.error(
        `${CONFIG.boardPath} has ${errors.length} lint error(s) — fix before running`,
      );
      process.exit(2);
    }
  }
  if (LINT_ONLY) {
    log('lint.done', { msg: `${errors.length} error(s), ${warnings.length} warning(s)` });
    process.exit(errors.length ? 2 : 0);
  }

  for (const bin of ['claude', 'git']) {
    try {
      sh('which', [bin]);
    } catch {
      console.error(`missing prerequisite: ${bin}`);
      process.exit(1);
    }
  }
  // W3-15: refuse a Node that doesn't match the project's pin — a mismatch
  // ABI-breaks native modules (better-sqlite3 here). The pin's LOCATION is
  // project-specific (CONFIG.nvmrcPath), and a project that pins nowhere is
  // skipped rather than refused: this used to be a bare readFileSync('.nvmrc')
  // that fataled any repo without a root .nvmrc — the same portability defect
  // W9-12 fixed for models.json, found the same way, by an external import.
  // Resolved against ROOT, not cwd, so the check does not depend on where the
  // conductor was invoked from.
  if (CONFIG.nvmrcPath) {
    const pinFile = resolve(ROOT, CONFIG.nvmrcPath);
    if (existsSync(pinFile)) {
      const mismatch = nodePinMismatch(process.version, readFileSync(pinFile, 'utf8'));
      if (mismatch) {
        console.error(
          `${mismatch} (pinned by ${CONFIG.nvmrcPath}) — fix PATH/fnm before running (W3-15)`,
        );
        process.exit(1);
      }
    }
  }
  if (CONFIG.holdTickets?.length)
    log('conductor.hold', {
      msg: `human-pair hold (F2): ${CONFIG.holdTickets.join(', ')} — never claimed unattended`,
    });
  if (git('status', '--porcelain')) {
    console.error('working tree not clean — commit or stash first');
    process.exit(1);
  }
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') git('checkout', '-q', 'main');

  // Stage 0 — baseline preflight (P2-01, Law L6). A red base means NO ticket
  // is claimable: file the repair, spend zero attempts. Exit code 3 is this
  // gate's distinct signature (supervise.sh must not treat it as a crash).
  if ((CONFIG.verifyCommands ?? []).length && !DRY) {
    const baseSha = git('rev-parse', 'HEAD');
    const lockfile = resolve(ROOT, 'pnpm-lock.yaml');
    const lockfileHash = existsSync(lockfile)
      ? createHash('sha256').update(readFileSync(lockfile)).digest('hex').slice(0, 16)
      : 'no-lockfile';
    log('baseline.start', {
      msg: `verifying base ${baseSha.slice(0, 12)} (cached runs are free)`,
    });
    const bl = ensureBaseline({
      baseSha,
      commands: CONFIG.verifyCommands,
      lockfileHash,
      cacheDir: resolve(ROOT, 'docs/work/baseline-cache'),
      worktreeDir: resolve(ROOT, CONFIG.worktreeDir),
      timeoutMin: CONFIG.gateTimeoutMin,
      git: (a) => sh('git', a).trim(),
      install: (wt) => {
        if (existsSync(resolve(wt, CONFIG.toolchainMarker)))
          sh(CONFIG.install[0], CONFIG.install[1], { cwd: wt, timeout: 10 * 60_000 });
      },
    });
    if (!bl.green) {
      for (const g of bl.gaps) log('baseline.red', { msg: g.split('\n')[0] });
      log('conductor.baseline-blocked', {
        msg: `base ${baseSha.slice(0, 12)} is RED (${bl.gaps.length} gap(s), key ${bl.key}) — blocked_on_baseline; ZERO ticket attempts consumed. Fix the base under its own ticket, then rerun.`,
      });
      process.exit(3);
    }
    log('baseline.green', {
      msg: `base ${baseSha.slice(0, 12)} verified${bl.cached ? ' (cache hit)' : ''} [key ${bl.key}]`,
    });
  }
  log('conductor.start', {
    msg: `breakpoint=${BREAKPOINT} waves=${WAVES ?? 'all'} isolation=${CONFIG.isolation} merge=${DO_MERGE} models=${JSON.stringify(MODELS)}`,
  });

  let doneCount = 0;
  // Tickets parked by --no-merge: done on their branch, still `todo` on the
  // board at ROOT. Must not be re-claimed, or the loop never terminates and
  // each re-claim resets the parked branch. See claimableTickets().
  const parkedThisRun = new Set();
  let lastWasInfra = false;
  let currentWave = null;
  let waveBase = git('rev-parse', 'HEAD');

  while (doneCount < MAX_TICKETS) {
    if (existsSync(STOPFILE)) {
      log('conductor.stop', { msg: 'STOP file' });
      break;
    }
    const next = claimable(loadPlan(), parkedThisRun)[0];
    if (!next) {
      log('conductor.idle', { msg: 'nothing claimable (done or all blocked)' });
      break;
    }

    if (currentWave && wave(next.id) !== currentWave) {
      const sec = await waveSecurityPass(currentWave, waveBase);
      if (sec === 'STOP') break;
      if (BREAKPOINT === 'wave') {
        log('conductor.breakpoint', { msg: `wave ${currentWave} complete` });
        break;
      }
      waveBase = git('rev-parse', 'HEAD');
    }
    currentWave = wave(next.id);

    if (DRY) {
      log('ticket.dry', { ticket: next.id, msg: `${next.title} [${pickModel(next)}]` });
      break;
    }
    log('ticket.start', { ticket: next.id, msg: `${next.title} [${pickModel(next)}]` });
    // P0-02 (Law L6): an environmental crash blocks THIS ticket with a named
    // blocked_on_infrastructure reason and the run continues to the next one —
    // it never kills the process and never reads as the ticket's code failing.
    // Two consecutive infra crashes = the environment itself is sick (ENOSPC
    // does not fix itself): stop the run cleanly instead of grinding every
    // remaining ticket into blocked.
    let res;
    try {
      res = await executeTicket(next);
    } catch (e) {
      if (!isInfraFailure(e)) throw e; // genuine executor defect: fail loud, fix the executor
      log('ticket.infra', { ticket: next.id, msg: infraGap(e) });
      markBlocked(next, [infraGap(e)], null, null, 'blocked_on_infrastructure');
      log('ticket.blocked', { ticket: next.id });
      if (lastWasInfra) {
        log('conductor.stop', {
          msg: 'two consecutive infrastructure failures — environment needs a human',
        });
        break;
      }
      lastWasInfra = true;
      continue;
    }
    lastWasInfra = false;
    if (res.ok) {
      if (land(next, res.branch, res.wt) === 'parked') parkedThisRun.add(next.id);
      // P6-02: in per-feature mode, every park is a chance a FEATURE just
      // completed — try to land any feature whose tickets are all parked-done
      // as ONE merge. Landed members leave parkedThisRun so the loop's
      // bookkeeping matches the board.
      if (CONFIG.landing === 'per-feature') {
        const landedIds = await tryFeatureLandings();
        for (const id of landedIds) parkedThisRun.delete(id);
      }
      doneCount++;
      log('ticket.done', { ticket: next.id, msg: `${doneCount} landed this run` });
      if (BREAKPOINT === 'ticket') {
        log('conductor.breakpoint', { msg: 'per-ticket breakpoint' });
        break;
      }
    } else if (res.split) {
      // P2-05: PARK -> mechanical split. The parent keeps its evidence branch;
      // the children are claimable immediately — the loop continues into them.
      parkForSplit(next, res.split, res.branch, res.wt, res.gaps ?? []);
    } else {
      markBlocked(
        next,
        res.gaps ?? ['unknown'],
        res.branch,
        res.wt,
        res.terminal ?? null,
      );
      log('ticket.blocked', { ticket: next.id });
    }
  }
  const counts = loadPlan().tickets.reduce(
    (m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m),
    {},
  );
  log('conductor.end', { msg: `landed=${doneCount} board=${JSON.stringify(counts)}` });
}

main().catch((e) => {
  log('conductor.fatal', { msg: e.message });
  process.exit(1);
});
