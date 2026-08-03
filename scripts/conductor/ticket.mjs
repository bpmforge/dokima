// conductor/ticket.mjs — the per-ticket attempt loop.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { parseJson, writePlan, codingPrompt, reviewDecision } from '../conductor-lib.mjs';
import { CONFIG, MODELS, ESCALATE, log, git, gitIn, tryLoadPlan, pickModel } from './context.mjs';
import { runGates } from './gates.mjs';

import { reviewPrompt } from './prompts.mjs';
import { runSession } from './session.mjs';
import { makeWorktree } from './worktree.mjs';

// ---------- per-ticket flow ----------
export async function executeTicket(t) {
  const { branch, wt } = makeWorktree(t);
  const attempts = [pickModel(t), pickModel(t), ...(ESCALATE ? [MODELS.escalate] : [])];
  let gaps = null;
  // Sticky findings: every HIGH/CRITICAL ever raised on this ticket, tracked to
  // CONFIRMED-fixed. A finding can never vanish because a later (non-deterministic)
  // reviewer instance fails to re-mention it — the harness analogue of the Challenger gate.
  const sticky = [];
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i > 0) {
      log('ticket.retry', { ticket: t.id, msg: `attempt ${i + 1} on ${model}` });
      resetStatus(wt, t.id);
    }
    await runSession(codingPrompt(t, gaps, CONFIG.boardPath), model, `code:${t.id}`, wt);
    const g = runGates(t, branch, wt);
    gaps = g.gaps;
    if (g.selfBlocked) {
      // Deliberate, not a failure: stop the attempt ladder and let markBlocked
      // record it. The agent's own reasoning is already committed to the branch.
      log('ticket.selfblocked', { ticket: t.id, msg: `agent set status=blocked on attempt ${i + 1} — honouring it, not retrying` });
      gaps = [`agent set status=blocked deliberately on attempt ${i + 1}; its reasoning is in the ticket's notes on the evidence branch`];
      break;
    }
    if (gaps.length) { log('gates.fail', { ticket: t.id, msg: gaps.join(' | ').slice(0, 400) }); continue; }

    const diff = git('diff', `main...${branch}`).slice(0, 180_000);
    const r = await runSession(reviewPrompt(t, diff, sticky, g.advisory), MODELS.reviewer, `review:${t.id}`, wt);
    const verdict = parseJson(r.out) ?? { verdict: 'FIX', findings: [{ severity: 'HIGH', file: '-', issue: 'review output unparseable', fix: 're-run review' }], prior_status: [] };

    // Findings the CURRENT pass raises fresh, and prior findings the reviewer — who is
    // shown every prior finding — explicitly says are STILL PRESENT. Those are the real
    // blockers. A prior finding that the reviewer neither re-raises nor marks PRESENT,
    // on an APPROVE verdict, is treated as resolved: an informed reviewer that has seen
    // the finding and approves is the authority, not my bookkeeping. (The earlier gate —
    // "APPROVE && zero-unresolved-sticky" with brittle text-matched resolution — false-
    // blocked W0-05/W1-01/W1-03: the reviewer APPROVED but the sticky rows never cleared.)
    const decision = reviewDecision(verdict);
    const { currentHigh, presentPriors, blockers, advisory } = decision;
    for (const f of currentHigh) {
      const key = `${f.file}:${f.issue}`;
      if (!sticky.some((s) => s.key === key)) sticky.push({ key, severity: f.severity, file: f.file, issue: f.issue, fix: f.fix });
    }
    log('review.result', { ticket: t.id, msg: `verdict=${verdict.verdict} newHigh=${currentHigh.length} priorsStillPresent=${presentPriors.length} (sticky-seen ${sticky.length})` });

    // See reviewDecision() in conductor-lib.mjs: the presence of blockers is the
    // decision, not the verdict string. A FIX verdict with nothing above MEDIUM
    // used to retry on an empty gap list and could block a ticket with an empty
    // ledger — "blocked" with no recorded reason.
    if (decision.approve) {
      if (decision.verdictOverridden) {
        log('review.approve', { ticket: t.id, msg: `verdict=${verdict.verdict} but no CRITICAL/HIGH findings and no still-present priors — treating as APPROVE; ${advisory.length} advisory finding(s) recorded, not blocking` });
      } else {
        log('review.approve', { ticket: t.id, msg: `informed APPROVE; ${sticky.length} prior finding(s) not re-raised${advisory.length ? `; ${advisory.length} advisory` : ''}` });
      }
      for (const a of advisory) log('review.advisory', { ticket: t.id, msg: `[${a.severity}] ${a.file}: ${a.issue}` });
      return { ok: true, branch, wt };
    }
    log('review.fix', { ticket: t.id, msg: `${blockers.length} blocker(s): ${currentHigh.length} new + ${presentPriors.length} still-present` });
    gaps = blockers;
  }
  // Block with the last pass's real blockers; if none captured, fall back to the sticky-seen list.
  const ledger = (gaps && gaps.length) ? gaps : sticky.map((s) => `[${s.severity}] ${s.file}: ${s.issue} — fix: ${s.fix}`);
  return { ok: false, branch, wt, gaps: ledger };
}

// Reset ticket status to in_progress IN THE WORKTREE (on the branch) so a stale
// blocked/done from a prior attempt doesn't pre-fail the next attempt's gate.
export function resetStatus(wt, id) {
  // A vanished worktree here must not kill the run: the reset is preparation
  // for a retry, and failing to prepare is a reason to skip the retry, not to
  // abort every remaining ticket.
  const { plan, err } = tryLoadPlan(wt);
  if (err) { log('reset.skipped', { ticket: id, msg: `board unreadable in worktree (${String(err.code || err.message)})` }); return; }
  const row = plan.tickets.find((x) => x.id === id);
  if (!row || row.status === 'in_progress') return;
  row.status = 'in_progress';
  writePlan(wt, plan, CONFIG.boardPath);
  // Best-effort: if nothing changed to commit (e.g. status was already reset
  // on a prior pass), git exits non-zero — not an error worth surfacing here.
  try { gitIn(wt, 'add', CONFIG.boardPath); gitIn(wt, 'commit', '-q', '-m', `chore(${id}): conductor resets status before retry`); } catch { /* intentional: nothing to commit */ }
}

