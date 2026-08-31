// conductor/context.mjs — module-level config, paths, CLI flags and shell/git helpers.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  loadConfigFile,
  loadPlanFrom,
  globToRegex,
  alwaysOkPatterns,
  validateModels,
  claimableTickets,
  riskHoldReason,
} from '../conductor-lib.mjs';

// W10-46: '../..', not '..'. This chapter lives in scripts/conductor/,
// one level deeper than the original scripts/conductor.mjs. With '..' this
// resolves to scripts/ and every derived path (LOG, STOPFILE, WT_BASE, the
// board) silently points at the wrong directory without throwing.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LOG = resolve(ROOT, 'docs/work/conductor-log.jsonl');
export const STOPFILE = resolve(ROOT, 'STOP');

// ---------- config (project-specific; script stays repo-agnostic) ----------
// A malformed conductor.config.json (e.g. hand-edited, trailing comma) is
// caught here and turned into a startup error naming the file and the
// parser's own reason, not a raw SyntaxError stack from the module job.
export const CONFIG = (() => {
  try {
    return loadConfigFile(ROOT, DEFAULT_CONFIG);
  } catch (e) {
    console.error(
      `conductor: ${e.message}\nFix conductor.config.json's JSON syntax, or delete the file to use built-in defaults.`,
    );
    process.exit(1);
  }
})();
export const WT_BASE = resolve(ROOT, CONFIG.worktreeDir);

// ---------- model routing (W9-12: config-only, no separate file) ----------
// Was a bare `readFileSync(scripts/models.json)` at module scope — a repo
// importing the conductor without that file crashed with a raw ENOENT stack
// at IMPORT time, before --lint or any argument parsing ran. Now it's part
// of CONFIG (already merged above), so a missing config falls back to
// DEFAULT_CONFIG.models cleanly. A malformed `models` value still needs a
// startup check — an actionable message here beats a wrong-model surprise
// deep inside a session run later.
export const MODELS = CONFIG.models;
{
  const modelErrors = validateModels(MODELS);
  if (modelErrors.length) {
    console.error(
      [
        'conductor: invalid model routing in conductor.config.json.',
        ...modelErrors.map((e) => `  - ${e}`),
        'Fix or add a "models" object in conductor.config.json (maker/cheap/reviewer/security/escalate',
        'model aliases) — or omit the key entirely to use the built-in default ladder',
        '(see DEFAULT_CONFIG.models in scripts/conductor-lib.mjs).',
      ].join('\n'),
    );
    process.exit(1);
  }
}

// ---------- args ----------
export const args = process.argv.slice(2);
export const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0
    ? args[i + 1] && !args[i + 1].startsWith('--')
      ? args[i + 1]
      : true
    : dflt;
};
export const WAVES = opt('waves', '')
  ? String(opt('waves', ''))
      .split(',')
      .map((s) => s.trim())
  : null;
export const BREAKPOINT = String(opt('breakpoint', 'never'));
export const MAX_TICKETS = Number(opt('max-tickets', 999));
export const SESSION_MIN = Number(opt('session-minutes', 45));
export const DO_MERGE = !args.includes('--no-merge');
export const DO_PUSH = !args.includes('--no-push');
export const DRY = args.includes('--dry-run');
export const ESCALATE = args.includes('--escalate');
export const LINT_ONLY = args.includes('--lint');

// ---------- utils ----------
export const now = () => new Date().toISOString();
export const log = (kind, data) => {
  const row = { ts: now(), kind, ...data };
  console.log(
    `[${row.ts}] ${kind}${data.ticket ? ` ${data.ticket}` : ''}${data.msg ? ` — ${data.msg}` : ''}`,
  );
  // Best-effort durable audit trail; console.log above already surfaced this
  // event, so a failed write here (disk full, permissions) is not fatal.
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify(row) + '\n');
  } catch {
    /* intentional: see comment above */
  }
};
export const sh = (cmd, cmdArgs, opts = {}) =>
  // 512MB buffer: git diffs on large tickets blow past execFileSync's 1MB default (ENOBUFS).
  execFileSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
export const git = (...a) => sh('git', a).trim(); // runs in ROOT (stays on main)
export const gitIn = (dir, ...a) => sh('git', a, { cwd: dir }).trim();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const loadPlan = (dir = ROOT) => loadPlanFrom(dir, CONFIG.boardPath);

// Same, but returns null instead of throwing when the board cannot be read —
// used at the two sites that run against a TICKET WORKTREE, which can vanish
// under us (crashed run, pruned worktree). See boardUnreadableGap.
export const tryLoadPlan = (dir) => {
  try {
    return { plan: loadPlan(dir), err: null };
  } catch (e) {
    return { plan: null, err: e };
  }
};

// Shared infra any ticket may touch regardless of write_scope (config-driven);
// always includes CONFIG.boardPath even if a project's alwaysOk override omits it.
export const ALWAYS_OK = alwaysOkPatterns(CONFIG).map(globToRegex);

/**
 * Ticket ids that already have a parked branch carrying commits.
 *
 * Under --no-merge a finished ticket's `done` status is committed only to its
 * own branch, so the board at ROOT still reads `todo`. The in-process
 * parkedThisRun set stops a re-claim within one run, but a RESTART begins with
 * an empty set and re-claims the ticket — and makeWorktree's pre-clean deletes
 * and recreates the branch, destroying the parked work. That happened to
 * kk/s-02 on Kryptkeeper 2026-07-28 (3 commits, recovered from the object
 * store only by luck), and the manual workaround — hand-adding every finished
 * ticket to holdTickets and renaming its branch out of the prefix — had to be
 * repeated for five tickets before this existed.
 *
 * Reading it off the branches makes restarts safe without bookkeeping.
 */
export function parkedBranchIds() {
  if (DO_MERGE) return []; // merged runs delete the branch; nothing to protect
  const ids = [];
  const boardOnly = new Set([CONFIG.boardPath, 'docs/STATUS.md']);
  for (const b of git('for-each-ref', '--format=%(refname:short)', 'refs/heads/').split(
    '\n',
  )) {
    if (!b || !b.startsWith(CONFIG.branchPrefix)) continue;
    try {
      if (Number(git('rev-list', '--count', `main..${b}`)) === 0) continue;
      // A branch whose ONLY commits touch the board is a claim ("mark
      // in_progress") left by a conductor that died mid-ticket. Counting it as
      // parked work strands its ticket permanently: nothing to protect, but the
      // ticket is skipped on every subsequent run and can never be re-claimed.
      // Observed on Kryptkeeper S-29, 2026-07-29 — one commit, one line, and the
      // ticket was unreachable until the branch was deleted by hand.
      //
      // Real parked work always touches something outside the board. Comparing
      // the file list is cheaper and more robust than reading the branch's board
      // and trusting a status field the dead session may never have written.
      const touched = git('diff', '--name-only', `main...${b}`)
        .split('\n')
        .filter(Boolean);
      if (touched.length && touched.every((f) => boardOnly.has(f))) {
        log('claim.stale-claim', {
          msg: `${b} carries only board commits (dead claim) — not treating as parked`,
        });
        continue;
      }
      ids.push(b.slice(CONFIG.branchPrefix.length).toUpperCase());
    } catch {
      /* branch vanished between listing and counting */
    }
  }
  return ids;
}

const riskHoldLogged = new Set(); // one held_for_human log per ticket per run, not per poll

export function claimable(plan, excluded = []) {
  const parked = parkedBranchIds();
  if (parked.length)
    log('claim.skip-parked', {
      msg: `already parked with commits: ${parked.join(', ')}`,
    });
  const base = claimableTickets(plan, {
    waves: WAVES,
    hold: CONFIG.holdTickets ?? [],
    excluded: [...excluded, ...parked],
  });
  // P2-07 (M-02): risk-tier admission — the 6/6 pilot filter. A ticket the
  // tier holds is not blocked and not failed; it simply is not claimable
  // UNATTENDED. It stays `todo`, visible, waiting for a human pass.
  const admitted = [];
  for (const t of base) {
    const reason = riskHoldReason(t, CONFIG.unattendedRisk);
    if (reason) {
      if (!riskHoldLogged.has(t.id)) {
        riskHoldLogged.add(t.id);
        log('ticket.held', { ticket: t.id, msg: reason });
      }
      continue;
    }
    admitted.push(t);
  }
  return admitted;
}

export function pickModel(t) {
  if (MODELS.cheapLanes?.includes(t.lane) || t.points <= (MODELS.cheapMaxPoints ?? 0))
    return MODELS.cheap;
  return MODELS.maker;
}
