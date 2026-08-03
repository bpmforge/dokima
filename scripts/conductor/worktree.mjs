// conductor/worktree.mjs — worktree lifecycle.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { resolve } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { CONFIG, WT_BASE, DRY, log, sh, git } from './context.mjs';

// ---------- worktree lifecycle ----------
export function makeWorktree(t) {
  const branch = `${CONFIG.branchPrefix}${t.id.toLowerCase()}`;
  const wt = resolve(WT_BASE, t.id);
  // Best-effort pre-clean of a stale worktree/branch left by a prior crashed
  // run; the common case is that none of these exist yet, which is fine.
  try { git('worktree', 'remove', '--force', wt); } catch { /* intentional: no prior worktree to remove */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* intentional: no prior worktree dir on disk */ }
  try { git('branch', '-D', branch); } catch { /* intentional: no prior branch to delete */ }
  mkdirSync(WT_BASE, { recursive: true });
  git('worktree', 'add', '-q', '-b', branch, wt, 'main');
  // Provision the tree the AGENT works in.
  //
  // CONFIG.install also runs in runGates(), but that is the conductor's own
  // post-session verification pass — by then the agent has already finished.
  // A fresh worktree has no node_modules/vendored deps, so without this the
  // agent cannot run the project's own lint/test command, and an honest agent
  // does exactly what the prompt tells it to: sets the ticket `blocked`.
  // Observed on Kryptkeeper 2026-07-28 — every ui-lane ticket blocked this
  // way (W3-02, W5-08), each burning a retry session first, with seven more
  // queued behind the same wall.
  //
  // Non-fatal: a failed install is logged, not thrown. The agent may still do
  // useful work, and runGates() re-runs install and will surface a real
  // breakage as a gap.
  if (!DRY && existsSync(resolve(wt, CONFIG.toolchainMarker))) {
    try {
      sh(CONFIG.install[0], CONFIG.install[1], { cwd: wt, timeout: 10 * 60_000 });
      log('worktree.install', { ticket: t.id, msg: 'dependencies installed for the agent session' });
    } catch (e) {
      log('worktree.install.warn', { ticket: t.id, msg: String(e.stdout || e.message).slice(-300) });
    }
  }
  return { branch, wt };
}
export function removeWorktree(wt) {
  // Best-effort teardown after landing/blocking a ticket; the worktree may
  // already be gone (e.g. a re-run after a partial failure).
  try { git('worktree', 'remove', '--force', wt); } catch { /* intentional: worktree already removed */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* intentional: dir already gone */ }
}

