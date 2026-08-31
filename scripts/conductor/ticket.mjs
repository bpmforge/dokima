// conductor/ticket.mjs — the per-ticket attempt loop.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import {
  parseJson,
  writePlan,
  codingPrompt,
  demoteReview,
  globToRegex,
  classifyTerminal,
} from '../conductor-lib.mjs';
import {
  CONFIG,
  MODELS,
  ESCALATE,
  ALWAYS_OK,
  log,
  git,
  gitIn,
  tryLoadPlan,
  pickModel,
} from './context.mjs';
import { runGates } from './gates.mjs';

import { reviewPrompt } from './prompts.mjs';
import { saveEvidence, gapHeads } from './evidence.mjs';
import { remediablePlan, applyRemediation } from './remediate.mjs';
import { runSession } from './session.mjs';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
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
  let mechanicalTried = false; // P2-03: one bounded pass per ticket, never more
  // P2-04 terminal bookkeeping — WHY the ladder ended decides which budget
  // (if any) was spent; the states and their budget semantics live in
  // conductor-lib/parsing.mjs TERMINAL_STATES.
  let lastDiffClass = null;
  let lastWasReview = false;
  let lastSelfBlocked = false;
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i > 0) {
      log('ticket.retry', { ticket: t.id, msg: `attempt ${i + 1} on ${model}` });
      resetStatus(wt, t.id);
    }
    try {
      await runSession(
        codingPrompt(t, gaps, CONFIG.boardPath),
        model,
        `code:${t.id}`,
        wt,
      );
    } catch (e) {
      // P2-04: the session runner already spent ITS OWN retry budget (12
      // limit-pauses). Exhausting it is a provider event, not feature-code
      // failure — never launch a second feature coding attempt for it.
      if (/limit retries exhausted/.test(String(e.message))) {
        return {
          ok: false,
          branch,
          wt,
          terminal: 'provider_attempts_exhausted',
          gaps: [
            `provider_attempts_exhausted: ${e.message} after the session runner's own retry budget — no coding attempt consumed`,
          ],
        };
      }
      throw e; // STOP file / infra: the main loop's classifier owns it
    }
    let g = runGates(t, branch, wt);
    // P2-03 — bounded mechanical remediation, ONCE per ticket: when every
    // failed verify command has an approved autofix and the failure is not
    // the base's own (blocked_on_baseline goes to the differential path),
    // run the fixer, reject any out-of-scope touch whole, commit the
    // amendment, and re-run the gates so scanners see the amended commit.
    // No coding attempt is consumed by the fix itself.
    if (
      g.gaps.length &&
      !mechanicalTried &&
      g.diff?.classification !== 'blocked_on_baseline'
    ) {
      const plan = remediablePlan(g.receipt, CONFIG.mechanicalFix ?? []);
      if (plan) {
        mechanicalTried = true;
        const scopeRes = t.write_scope.map(globToRegex);
        const res = applyRemediation({
          wt,
          ticketId: t.id,
          plan,
          scopeRes,
          alwaysOkRes: ALWAYS_OK,
        });
        if (res.applied) {
          log('ticket.remediated', {
            ticket: t.id,
            msg: `mechanical fix applied to ${res.changed.length} file(s) — re-running gates; no attempt consumed`,
          });
          g = runGates(t, branch, wt);
        } else if (res.rejected?.length) {
          log('ticket.remediation-rejected', {
            ticket: t.id,
            msg: `autofix touched out-of-scope file(s), reverted whole: ${res.rejected.join(', ')}`,
          });
        } else {
          log('ticket.remediation-skipped', {
            ticket: t.id,
            msg: res.error ?? 'no diff',
          });
        }
      }
    }
    gaps = g.gaps;
    lastDiffClass = g.diff?.classification ?? null;
    lastWasReview = false;
    if (g.selfBlocked) {
      lastSelfBlocked = true;
      // Deliberate, not a failure: stop the attempt ladder and let markBlocked
      // record it. The agent's own reasoning is already committed to the branch.
      log('ticket.selfblocked', {
        ticket: t.id,
        msg: `agent set status=blocked on attempt ${i + 1} — honouring it, not retrying`,
      });
      gaps = [
        `agent set status=blocked deliberately on attempt ${i + 1}; its reasoning is in the ticket's notes on the evidence branch`,
      ];
      break;
    }
    if (gaps.length) {
      // P2-02: the differential owns the causal call. A candidate whose only
      // failures are the base's own failures is NOT a failed candidate — it is
      // blocked_on_baseline: stop the ladder, preserve the branch, charge
      // nothing. Deterministic code decides; no prose can override it.
      if (g.diff?.classification === 'blocked_on_baseline') {
        gaps = [
          `blocked_on_baseline: every candidate failure fingerprint (${g.diff.sharedRows.length}) already fails on the base — ` +
            `zero coding attempts charged; candidate preserved for resume after the base repair. ` +
            `Shared: ${g.diff.sharedRows
              .map((r) => `${r.errorClass}@${r.suite}`)
              .slice(0, 5)
              .join(', ')}`,
        ];
        log('ticket.baseline-blocked', { ticket: t.id, msg: gaps[0] });
        break;
      }
      // P2-02 mixed: only the NEW failures are the candidate's to fix — the
      // retry prompt must not send the coder chasing the base's debt.
      if (g.diff?.classification === 'mixed') {
        const newLines = g.diff.newRows.map(
          (r) =>
            `NEW failure: [${r.errorClass}] ${r.suite}${r.test ? ` > ${r.test}` : ''}`,
        );
        const ev0 = saveEvidence(
          t.id,
          `mixed-differential-attempt${i + 1}`,
          gaps.join('\n\n---\n\n'),
        );
        gaps = [
          ...newLines,
          `(${g.diff.sharedRows.length} further failure(s) are pre-existing on the base — excluded from this ticket; full verify output: ${ev0})`,
        ];
      }
      // P0-03: one line per gap (first line each), full text to evidence —
      // the old 400-byte slice of the join produced mid-word fragments
      // ("pnpm test failed: eout") that hid the terminal cause.
      const ev = saveEvidence(
        t.id,
        `gates-fail-attempt${i + 1}`,
        gaps.join('\n\n---\n\n'),
      );
      log('gates.fail', { ticket: t.id, msg: `${gapHeads(gaps)} [full: ${ev}]` });
      continue;
    }

    const diff = git('diff', `main...${branch}`).slice(0, 180_000);
    const r = await runSession(
      reviewPrompt(t, diff, sticky, g.advisory),
      MODELS.reviewer,
      `review:${t.id}`,
      wt,
    );
    const verdict = parseJson(r.out) ?? {
      verdict: 'UNPARSEABLE',
      findings: [],
      prior_status: [],
    };

    // P2-06 (Law L2) — THE LLM VERDICT IS ADVISORY. The field report proved
    // review-as-a-hard-gate fails both ways (a hash-forgery merged; 75% of
    // one stretch's blocks were false). Deterministic gates — receipts,
    // validators, tests — already passed above and OWN the merge. The
    // reviewer may label, rank, and demand a deterministic check; it cannot
    // block, and its findings must survive the citation gate first:
    // an unresolvable file citation is the fabricated-REJECT shape and is
    // discarded unread (RDSAD-234).
    const review = demoteReview(verdict, (f) => existsSync(resolvePath(wt, f)));
    for (const d of review.discarded) {
      log('review.discarded', {
        ticket: t.id,
        msg: `citation does not resolve — dropped: [${d?.severity ?? '?'}] ${d?.file ?? '(no file)'}: ${String(d?.issue ?? '').slice(0, 160)}`,
      });
    }
    for (const a of review.advisory) {
      const key = `${a.file}:${a.issue}`;
      if (!sticky.some((x) => x.key === key))
        sticky.push({
          key,
          severity: a.severity,
          file: a.file,
          issue: a.issue,
          fix: a.fix,
        });
      log('review.advisory', {
        ticket: t.id,
        msg: `[${a.severity}] ${a.file}: ${a.issue}`,
      });
    }
    for (const c of review.demandedChecks) {
      log('review.demand', {
        ticket: t.id,
        msg: `reviewer demands deterministic check: ${c} — record for promotion via the red-fixture pipeline, not an inline block`,
      });
    }
    if (review.advisory.length || review.discarded.length) {
      saveEvidence(
        t.id,
        'review-findings',
        JSON.stringify(
          {
            verdict: review.verdict,
            advisory: review.advisory,
            discarded: review.discarded,
          },
          null,
          2,
        ),
      );
    }
    log('review.result', {
      ticket: t.id,
      msg: `verdict=${review.verdict} (advisory — deterministic gates already green): ${review.advisory.length} cited finding(s), ${review.discarded.length} discarded, ${review.demandedChecks.length} demanded check(s)`,
    });
    // Deterministic gates green + evidence recorded -> land. An APPROVE with
    // stale sticky rows can no longer false-block (the W0-05/W1-01/W1-03
    // shape): sticky is a ledger for humans and later prompts, not a gate.
    return { ok: true, branch, wt };
  }
  // Block with the last pass's real blockers; if none captured, fall back to the sticky-seen list.
  const ledger =
    gaps && gaps.length
      ? gaps
      : sticky.map((s) => `[${s.severity}] ${s.file}: ${s.issue} — fix: ${s.fix}`);
  const terminal = classifyTerminal({
    gaps: ledger,
    diffClassification: lastDiffClass,
    reviewExhausted: lastWasReview,
    selfBlocked: lastSelfBlocked,
  });
  log('ticket.terminal', { ticket: t.id, msg: terminal });
  return { ok: false, branch, wt, gaps: ledger, terminal };
}

// Reset ticket status to in_progress IN THE WORKTREE (on the branch) so a stale
// blocked/done from a prior attempt doesn't pre-fail the next attempt's gate.
export function resetStatus(wt, id) {
  // A vanished worktree here must not kill the run: the reset is preparation
  // for a retry, and failing to prepare is a reason to skip the retry, not to
  // abort every remaining ticket.
  const { plan, err } = tryLoadPlan(wt);
  if (err) {
    log('reset.skipped', {
      ticket: id,
      msg: `board unreadable in worktree (${String(err.code || err.message)})`,
    });
    return;
  }
  const row = plan.tickets.find((x) => x.id === id);
  if (!row || row.status === 'in_progress') return;
  row.status = 'in_progress';
  writePlan(wt, plan, CONFIG.boardPath);
  // Best-effort: if nothing changed to commit (e.g. status was already reset
  // on a prior pass), git exits non-zero — not an error worth surfacing here.
  try {
    gitIn(wt, 'add', CONFIG.boardPath);
    gitIn(wt, 'commit', '-q', '-m', `chore(${id}): conductor resets status before retry`);
  } catch {
    /* intentional: nothing to commit */
  }
}
