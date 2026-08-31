// conductor/gates.mjs — out-of-session gate checks, run in the ticket worktree.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  doneCheckGap,
  boardUnreadableGap,
  globToRegex,
  selectGates,
} from '../conductor-lib.mjs';
import { CONFIG, ROOT, DRY, log, sh, git, tryLoadPlan, ALWAYS_OK } from './context.mjs';
import { runValidators } from './session.mjs';
import { mintReceipt, receiptGaps } from './receipts.mjs';
import { saveEvidence } from './evidence.mjs';
import { receiptFingerprints, classifyDifferential } from './fingerprint.mjs';
import { loadCurrentBaseline } from './baseline.mjs';

// Parses one `git diff --name-status` line into `{ status, file }`. A rename
// or copy line has three tab-separated fields (`R100\told\tnew`) instead of
// two — `file` always takes the LAST field (the path as it exists on the
// ticket branch), and `status` collapses to its leading letter (`R100` ->
// `R`) so callers compare against a plain A/M/D/R/C rather than a similarity
// score. Renames deliberately do NOT count as an addition: the old numbered
// filename still stops existing at that path, which is the same shape of
// problem as a modify for an append-only path (see ADD_ONLY_OK).
function parseChangedStatus(line) {
  const parts = line.split('\t');
  return { status: parts[0][0], file: parts[parts.length - 1] };
}

// W11-09: alwaysOk (scripts/conductor-lib/config.mjs, scripts/conductor/context.mjs)
// is pure path matching with no added-vs-modified distinction, so
// `packages/events/migrations/**` being alwaysOk (2026-07-16, so a ticket
// adding a table can drop in a new numbered file) also let any ticket EDIT an
// already-shipped migration in place without tripping the scope gate. An
// in-place edit to a committed migration does not re-apply to a `state.db`
// that already ran it (`applyMigrations` keys off `PRAGMA user_version` plus
// the file's numeric prefix) — it looks applied in a fresh checkout/CI and is
// silently absent everywhere else.
//
// Fixed here as a DEDICATED check, not by changing alwaysOk/globToRegex/
// ALWAYS_OK themselves: those live in scripts/conductor-lib/config.mjs and
// scripts/conductor/context.mjs, both outside this ticket's write_scope, and
// — more importantly — the distinction only belongs to append-only paths.
// The rest of alwaysOk (the board, the lockfile, tsconfig, ...) is genuinely
// modify-in-place infra; narrowing alwaysOk itself to additions-only would
// break every one of those. CONFIG.alwaysOkAddOnly names the subset of
// alwaysOk-covered globs that get the narrower, status-aware treatment; see
// conductor.config.json's $alwaysOkAddOnlyNote.
const ADD_ONLY_OK = (CONFIG.alwaysOkAddOnly ?? []).map(globToRegex);

// ---------- gates (run OUTSIDE the session, in the ticket's worktree) ----------
export function runGates(t, branch, wt) {
  const gaps = [];
  let diff = null; // P2-02 differential verdict (null when no baseline/receipt failure)
  const { plan: wtPlan, err: wtPlanErr } = tryLoadPlan(wt);
  if (wtPlanErr) {
    log('gates.board-unreadable', {
      ticket: t.id,
      msg: String(wtPlanErr.code || wtPlanErr.message),
    });
    return {
      gaps: [boardUnreadableGap(CONFIG.boardPath, wtPlanErr)],
      advisory: [],
      selfBlocked: false,
      diff: null,
    };
  }
  const row = wtPlan.tickets.find((x) => x.id === t.id);
  // An agent that sets `blocked` is obeying the prompt ("If genuinely blocked
  // after one honest attempt: set status blocked with a notes entry"), not
  // failing a gate. Retrying it re-runs a full session to reach the identical
  // conclusion — observed twice on Kryptkeeper 2026-07-28 (W3-02, W5-08), and
  // the W3-02 agent predicted it: "resetting status to in_progress without
  // correcting it will reproduce this same block every retry."
  const selfBlocked = row?.status === 'blocked';
  if (!row || row.status !== 'done')
    gaps.push(doneCheckGap(row?.status, CONFIG.boardPath));
  if (Number(git('rev-list', '--count', `main..${branch}`)) < 1)
    gaps.push('no commits on ticket branch');
  const changed = git('diff', '--name-status', `main...${branch}`)
    .split('\n')
    .filter(Boolean)
    .map(parseChangedStatus);
  const changedFiles = changed.map(({ file }) => file);
  const scopeRes = t.write_scope.map(globToRegex);
  const outOfScope = changed
    .filter(({ file, status }) => {
      if (scopeRes.some((r) => r.test(file))) return false;
      if (ALWAYS_OK.some((r) => r.test(file))) return false;
      // Add-only exemption: only a pure addition (status 'A') to an
      // alwaysOkAddOnly path is exempt — a modify/delete/rename on an
      // existing numbered file stays out-of-scope unless write_scope names
      // it explicitly.
      return !(status === 'A' && ADD_ONLY_OK.some((r) => r.test(file)));
    })
    .map(({ file }) => file);
  if (outOfScope.length) gaps.push(`out-of-scope edits: ${outOfScope.join(', ')}`);
  let advisory = [];
  if (existsSync(resolve(wt, CONFIG.toolchainMarker)) && !DRY) {
    try {
      sh(CONFIG.install[0], CONFIG.install[1], { cwd: wt, timeout: 10 * 60_000 });
    } catch (e) {
      gaps.push(`install failed: ${String(e.stdout || e.message).slice(-300)}`);
    }
    // Untrusted verify receipts (P0-01, Law L1): the conductor — never the
    // agent session — runs the trust commands and mints the receipt. Any
    // pre-existing receipt file for this ticket+sha is overwritten unread, so
    // a hand-edited "exitCode: 0" simply gets replaced by reality. The gate
    // then asserts the receipt: missing, stale-sha, or nonzero all gap, with
    // the failing command's tail UNTRUNCATED (the operator must see the real
    // cause, not a fragment).
    if ((CONFIG.verifyCommands ?? []).length) {
      const headSha = sh('git', ['rev-parse', 'HEAD'], { cwd: wt }).trim();
      const { receipt, path: rPath } = mintReceipt({
        ticketId: t.id,
        wt,
        headSha,
        commands: CONFIG.verifyCommands,
        receiptsDir: resolve(ROOT, 'docs/work/receipts'),
        timeoutMin: CONFIG.gateTimeoutMin,
      });
      const rGaps = receiptGaps(receipt, headSha);
      if (rGaps.length) {
        log('gates.receipt', {
          ticket: t.id,
          msg: `receipt FAIL (${rGaps.length} gap(s)) -> ${rPath}`,
        });
        gaps.push(...rGaps);
        // P2-02: base-vs-candidate differential. Deterministic code makes the
        // causal call; prose can never override it. Only NEW failures may be
        // charged to the candidate.
        const base = loadCurrentBaseline(resolve(ROOT, 'docs/work/baseline-cache'));
        if (base) {
          diff = classifyDifferential(base.rows ?? [], receiptFingerprints(receipt));
          log('gates.differential', {
            ticket: t.id,
            msg: `${diff.classification}: ${diff.newRows.length} new / ${diff.sharedRows.length} shared-with-base failure fingerprint(s) [base ${String(base.baseSha).slice(0, 12)}]`,
          });
        }
      } else {
        log('gates.receipt', {
          ticket: t.id,
          msg: `receipt ok: ${receipt.commands.length} command(s) attested @ ${headSha.slice(0, 12)} -> ${rPath}`,
        });
      }
    }
    // Scope-conditional gates: a frontend suite run for a backend-only ticket is
    // not extra safety, it is extra failure surface. See selectGates().
    const { run: gatesToRun, skipped: gatesSkipped } = selectGates(CONFIG.gates, t);
    for (const g of gatesSkipped) {
      log('gates.skip', {
        ticket: t.id,
        msg: `${g.cmd} ${(g.args || []).join(' ')} — write_scope matches none of ${g.when.join(', ')}`,
      });
    }
    for (const [cmd, cmdArgs] of gatesToRun) {
      try {
        sh(cmd, cmdArgs, { cwd: wt, timeout: CONFIG.gateTimeoutMin * 60_000 });
      } catch (e) {
        // Full output to evidence, tail inline (P0-03): the operator sees the
        // real terminal cause and has the whole thing on disk, not a fragment.
        const full = String(e.stdout || '') + String(e.stderr || '') || String(e.message);
        const ev = saveEvidence(t.id, `gate-${cmd}-${cmdArgs[0] ?? ''}`, full);
        gaps.push(
          `${cmd} ${cmdArgs[0] ?? ''} failed (full output: ${ev}): ${full.slice(-800)}`,
        );
      }
    }
    // deterministic validator gates (diff-scoped) — hard gaps
    const vGaps = runValidators(wt, changedFiles, CONFIG.validators?.gate);
    if (vGaps.length) {
      log('validators.gate', {
        ticket: t.id,
        msg: `${vGaps.length} diff-scoped violation(s)`,
      });
      gaps.push(...vGaps);
    }
    // heuristic validators — anchor the review (verified, not blocking)
    advisory = runValidators(wt, changedFiles, CONFIG.validators?.advisory);
    if (advisory.length)
      log('validators.advisory', {
        ticket: t.id,
        msg: `${advisory.length} finding(s) fed to review`,
      });
  }
  return { gaps, advisory, selfBlocked, diff };
}
