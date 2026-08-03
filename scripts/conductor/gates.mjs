// conductor/gates.mjs — out-of-session gate checks, run in the ticket worktree.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { doneCheckGap, boardUnreadableGap, globToRegex, selectGates } from '../conductor-lib.mjs';
import { CONFIG, DRY, log, sh, git, tryLoadPlan, ALWAYS_OK } from './context.mjs';
import { runValidators } from './session.mjs';

// ---------- gates (run OUTSIDE the session, in the ticket's worktree) ----------
export function runGates(t, branch, wt) {
  const gaps = [];
  const { plan: wtPlan, err: wtPlanErr } = tryLoadPlan(wt);
  if (wtPlanErr) {
    log('gates.board-unreadable', { ticket: t.id, msg: String(wtPlanErr.code || wtPlanErr.message) });
    return { gaps: [boardUnreadableGap(CONFIG.boardPath, wtPlanErr)], advisory: [], selfBlocked: false };
  }
  const row = wtPlan.tickets.find((x) => x.id === t.id);
  // An agent that sets `blocked` is obeying the prompt ("If genuinely blocked
  // after one honest attempt: set status blocked with a notes entry"), not
  // failing a gate. Retrying it re-runs a full session to reach the identical
  // conclusion — observed twice on Kryptkeeper 2026-07-28 (W3-02, W5-08), and
  // the W3-02 agent predicted it: "resetting status to in_progress without
  // correcting it will reproduce this same block every retry."
  const selfBlocked = row?.status === 'blocked';
  if (!row || row.status !== 'done') gaps.push(doneCheckGap(row?.status, CONFIG.boardPath));
  if (Number(git('rev-list', '--count', `main..${branch}`)) < 1) gaps.push('no commits on ticket branch');
  const changed = git('diff', '--name-only', `main...${branch}`).split('\n').filter(Boolean);
  const scopeRes = t.write_scope.map(globToRegex);
  const outOfScope = changed.filter((f) => !scopeRes.some((r) => r.test(f)) && !ALWAYS_OK.some((r) => r.test(f)));
  if (outOfScope.length) gaps.push(`out-of-scope edits: ${outOfScope.join(', ')}`);
  let advisory = [];
  if (existsSync(resolve(wt, CONFIG.toolchainMarker)) && !DRY) {
    try { sh(CONFIG.install[0], CONFIG.install[1], { cwd: wt, timeout: 10 * 60_000 }); } catch (e) { gaps.push(`install failed: ${String(e.stdout || e.message).slice(-300)}`); }
    // Scope-conditional gates: a frontend suite run for a backend-only ticket is
    // not extra safety, it is extra failure surface. See selectGates().
    const { run: gatesToRun, skipped: gatesSkipped } = selectGates(CONFIG.gates, t);
    for (const g of gatesSkipped) {
      log('gates.skip', { ticket: t.id, msg: `${g.cmd} ${(g.args || []).join(' ')} — write_scope matches none of ${g.when.join(', ')}` });
    }
    for (const [cmd, cmdArgs] of gatesToRun) {
      try { sh(cmd, cmdArgs, { cwd: wt, timeout: CONFIG.gateTimeoutMin * 60_000 }); }
      catch (e) { gaps.push(`${cmd} ${cmdArgs[0]} failed: ${String(e.stdout || e.message).slice(-800)}`); }
    }
    // deterministic validator gates (diff-scoped) — hard gaps
    const vGaps = runValidators(wt, changed, CONFIG.validators?.gate);
    if (vGaps.length) { log('validators.gate', { ticket: t.id, msg: `${vGaps.length} diff-scoped violation(s)` }); gaps.push(...vGaps); }
    // heuristic validators — anchor the review (verified, not blocking)
    advisory = runValidators(wt, changed, CONFIG.validators?.advisory);
    if (advisory.length) log('validators.advisory', { ticket: t.id, msg: `${advisory.length} finding(s) fed to review` });
  }
  return { gaps, advisory, selfBlocked };
}

