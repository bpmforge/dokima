// conductor/land.mjs — merge, push, and honest-block handling.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import {
  ROOT,
  CONFIG,
  DO_MERGE,
  DO_PUSH,
  ESCALATE,
  now,
  log,
  sh,
  git,
  loadPlan,
} from './context.mjs';
import { writePlan, terminalNote } from '../conductor-lib.mjs';
import { removeWorktree } from './worktree.mjs';
import { saveEvidence, gapHeads } from './evidence.mjs';

export function pushRemotes(ticket, extraBranch = null) {
  if (!DO_PUSH) return;
  // `extraBranch` is the ticket's own branch, pushed alongside main. Without it
  // a blocked ticket's evidence branch and a --no-merge parked branch only ever
  // existed on this machine: pushRemotes pushed main, and main is exactly what
  // does NOT contain them. Kryptkeeper 2026-07-28 ran for an hour with every
  // completed and every blocked branch unreplicated.
  const refs = ['main', ...(extraBranch ? [extraBranch] : [])];
  for (const rem of CONFIG.remotes) {
    for (const ref of refs) {
      try {
        sh('git', ['push', rem, ref], { timeout: 60_000 });
      } catch (e) {
        log('push.fail', {
          ticket,
          msg: `${rem} ${ref}: ${String(e.message).slice(0, 80)}`,
        });
      }
    }
  }
}

export function land(t, branch, wt) {
  // ROOT stays on main throughout — just merge the branch and clean up the worktree.
  if (DO_MERGE) {
    try {
      git(
        'merge',
        '--no-ff',
        '-q',
        '-m',
        `Merge ${branch}: ${t.id} ${t.title}\n\nConductor-verified: gates green + independent review APPROVE (sticky findings all resolved).\nStanding approval: docs/work/APPROVALS.md A-001.\n\nCo-Authored-By: Claude (conductor run) <noreply@anthropic.com>`,
        branch,
      );
    } catch {
      // Merge conflict (main moved since the branch forked — L-30): NEVER fatal here.
      // A fatal crashes the conductor, and the supervisor's cleanup then deletes the
      // finished, reviewed branch (the W4-01 incident). Abort, preserve the branch
      // outside the sw/ cleanup namespace, park the ticket for human integration.
      try {
        git('merge', '--abort');
      } catch {
        /* intentional: no in-progress merge to abort */
      }
      markBlocked(
        t,
        [
          `merge conflict vs moved main — reviewed work preserved (gates+review already green); human integrates`,
        ],
        branch,
        wt,
      );
      return;
    }
    removeWorktree(wt);
    // Best-effort: branch may already be gone (e.g. re-run after a partial land).
    try {
      git('branch', '-d', branch);
    } catch {
      /* intentional: branch already deleted */
    }
    // If the merge touched any package.json, ROOT's node_modules is now stale —
    // re-link workspace deps so a subsequent test on ROOT (e.g. the stop-hook's
    // `npm test`) doesn't hit "Cannot find package @dokima/*" (L-40).
    try {
      const merged = git('diff', '--name-only', 'HEAD~1', 'HEAD');
      if (/(^|\/)package\.json$/m.test(merged)) {
        const [bin, args] = CONFIG.install;
        sh(bin, args, { cwd: ROOT });
        log('land.install', {
          ticket: t.id,
          msg: 'package.json changed — re-linked ROOT workspace deps',
        });
      }
    } catch (err) {
      log('land.install.warn', { ticket: t.id, msg: String(err).slice(0, 200) });
    }
    pushRemotes(t.id);
  } else {
    log('parked', {
      ticket: t.id,
      msg: `left on ${branch} (worktree ${wt}) for review (--no-merge)`,
    });
    // Push the parked branch: it holds finished, gate-green, review-approved
    // work that main will not carry until a human merges it.
    pushRemotes(t.id, branch);
    return 'parked';
  }
  return 'merged';
}

export function markBlocked(t, gaps, branch, wt, terminal = null) {
  // Block status is recorded on main (ROOT); the branch is kept for inspection, worktree removed.
  // branch/wt may be NULL (P0-02): an infrastructure crash can predate worktree
  // creation, and blocking the ticket must not itself crash on the absence.
  const plan = loadPlan();
  const row = plan.tickets.find((x) => x.id === t.id);
  if (!row) return; // board drifted under us — nothing to record on
  row.status = 'blocked';
  // P2-04: the terminal STATE rides on the row and leads the note — six named
  // reasons replace the overloaded 'blocked', and only two of them spend the
  // implementation retry budget (TERMINAL_STATES in conductor-lib).
  if (terminal) row.terminal = terminal;
  // notes is historically string-or-array (review-pass tickets use strings) — normalize.
  if (!Array.isArray(row.notes)) row.notes = row.notes ? [row.notes] : [];
  // P0-03: the note leads with the LATEST blocker's head; the complete gap
  // text (all attempts, untruncated) lives in evidence and is pointed to.
  const evPath = saveEvidence(t.id, 'blocked-gaps', gaps.join('\n\n---\n\n'));
  row.notes.push(
    `CONDUCTOR ${now()}: ${terminal ? `${terminalNote(terminal)} ` : ''}blocked after ${ESCALATE ? 3 : 2} attempts.${branch ? ` Branch ${branch} kept.` : ''} Latest blocker: ${gapHeads(gaps.slice(0, 3))} [full: ${evPath}]`,
  );
  writePlan(ROOT, plan, CONFIG.boardPath);
  git('add', CONFIG.boardPath);
  git('commit', '-q', '-m', `chore(${t.id}): conductor marks blocked with evidence`);
  if (!branch && !wt) return; // infra crash before any worktree existed
  removeWorktree(wt);
  // Rename the kept evidence branch OUT of the sw/ namespace: supervise.sh's crash
  // cleanup deletes sw/* branches on every restart, which was silently destroying
  // blocked tickets' "Branch kept" evidence (LESSONS L-16). Unique-suffix on
  // collision — a re-blocked ticket must not leave attempt 2 in the kill-zone.
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  let keepName = `blocked/${t.id.toLowerCase()}`;
  try {
    git('rev-parse', '--verify', keepName);
    keepName = `${keepName}-${stamp}`;
  } catch {
    /* free */
  }
  try {
    git('branch', '-m', branch, keepName);
  } catch {
    /* branch may not exist */
  }
  pushRemotes(t.id, keepName);
}

/**
 * P2-05 SPLIT landing: park the parent (markBlocked bookkeeping — note,
 * evidence, kept branch) and file its mechanical split children on the board
 * at ROOT so the very next claim can pick them up. The parent consumed no
 * further attempt; the children are ordinary todo tickets.
 */
export function parkForSplit(t, children, branch, wt, gaps) {
  markBlocked(t, gaps, branch, wt, null);
  const plan = loadPlan();
  const row = plan.tickets.find((x) => x.id === t.id);
  if (row) row.terminal = 'parked_for_split';
  for (const c of children) {
    if (!plan.tickets.some((x) => x.id === c.id)) plan.tickets.push(c);
  }
  writePlan(ROOT, plan, CONFIG.boardPath);
  git('add', CONFIG.boardPath);
  git(
    'commit',
    '-q',
    '-m',
    `chore(${t.id}): parked at the PROGRESSED ceiling; split into ${children.map((c) => c.id).join(' + ')}`,
  );
  log('ticket.split', {
    ticket: t.id,
    msg: `parked_for_split -> ${children.map((c) => c.id).join(', ')} now claimable`,
  });
}
