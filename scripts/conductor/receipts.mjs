// conductor/receipts.mjs — untrusted verify receipts (P0-01, EXECUTION_PLAN Law L1).
//
// THE AGENT NEVER AUTHORS ITS OWN EVIDENCE. The Marauder field report
// (2026-07-27, failure #1) recorded false "tsc/tests clean" claims in four of
// five named tickets; CLAUDE.md Law 4 already mandates that no component
// verifies its own output. This module is that law in the executor: the
// conductor — never the agent session — runs the project's declared verify
// commands and writes a receipt naming each command, its exit code, its
// output tail, and the exact commit it ran at. The gate then asserts the
// receipt, and a pre-existing file is IGNORED — mintReceipt always re-runs
// and overwrites, so a hand-edited receipt claiming success is simply
// replaced by reality (re-derive, never trust).
//
// Receipts live under ROOT/docs/work/receipts/, beside the worktrees rather
// than inside them, and the directory is self-gitignored so evidence never
// dirties the target repository (the M-08 lesson: a force-added evidence
// commit once left a main checkout dirty and refused the next run).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where a ticket+sha's receipt lives. sha is shortened for a stable filename. */
export function receiptPath(receiptsDir, ticketId, headSha) {
  return resolve(receiptsDir, `${ticketId}-${headSha.slice(0, 12)}.json`);
}

/**
 * Run every declared verify command in the worktree and write the receipt.
 * The caller (runGates) is the only invoker — an agent session has no path
 * to this function, and any receipt file already on disk for this ticket+sha
 * is overwritten unread.
 *
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {string} opts.wt            worktree to run commands in
 * @param {string} opts.headSha      candidate commit the commands run against
 * @param {Array}  opts.commands     [[cmd, [args]], ...] — CONFIG.verifyCommands
 * @param {string} opts.receiptsDir  ROOT/docs/work/receipts
 * @param {number} opts.timeoutMin   per-command timeout
 * @returns {{receipt: object, path: string}}
 */
export function mintReceipt({ ticketId, wt, headSha, commands, receiptsDir, timeoutMin = 15, env = process.env }) {
  mkdirSync(receiptsDir, { recursive: true });
  // Self-ignoring directory: receipts are audit artifacts, never tracked.
  const gi = resolve(receiptsDir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n!.gitignore\n');

  const results = [];
  for (const [cmd, args = []] of commands) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let exitCode = 0;
    let out = '';
    try {
      out = execFileSync(cmd, args, {
        cwd: wt, encoding: 'utf8', timeout: timeoutMin * 60_000,
        maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env,
      });
    } catch (e) {
      // A spawn failure (ENOENT) has no status; treat as nonzero with the message.
      exitCode = typeof e.status === 'number' ? e.status : 1;
      out = `${e.stdout || ''}${e.stderr || ''}` || String(e.message);
    }
    results.push({
      command: [cmd, ...args].join(' '),
      exitCode,
      // Tail, not head: failures print last. Full output is the worktree's
      // problem to preserve (P0-03 evidence files); the receipt carries enough
      // to name the failure without a re-run.
      tailOfOutput: String(out).slice(-4000),
      startedAt,
      durationMs: Date.now() - t0,
    });
    // Fail fast: later commands on a broken tree waste minutes and blur the
    // terminal cause (the truncated-summary lesson).
    if (exitCode !== 0) break;
  }

  const receipt = { ticketId, headSha, mintedAt: new Date().toISOString(), commands: results };
  const path = receiptPath(receiptsDir, ticketId, headSha);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
  return { receipt, path };
}

/**
 * Pure gate check over a receipt. Returns gap strings; empty = pass.
 * Asserted separately from minting so land() and tests can re-verify a
 * receipt against the commit that is actually being merged.
 */
export function receiptGaps(receipt, expectedSha) {
  if (!receipt) return ['verify receipt missing — the wrapper never ran; nothing below this gate is trustworthy'];
  const gaps = [];
  if (receipt.headSha !== expectedSha) {
    gaps.push(`verify receipt is for ${String(receipt.headSha).slice(0, 12)} but the candidate commit is ${String(expectedSha).slice(0, 12)} — stale or forged; re-run required`);
  }
  for (const c of receipt.commands ?? []) {
    if (c.exitCode !== 0) {
      // Untruncated by design (P0-01 acceptance): the operator must see the
      // real cause, not a fragment.
      gaps.push(`verify command failed (exit ${c.exitCode}): ${c.command}\n${c.tailOfOutput}`);
    }
  }
  if (!Array.isArray(receipt.commands) || receipt.commands.length === 0) {
    gaps.push('verify receipt lists no commands — verifyCommands is empty or the wrapper was bypassed');
  }
  return gaps;
}

/** Load a receipt for land-time re-verification. Missing file -> null. */
export function loadReceipt(receiptsDir, ticketId, headSha) {
  const p = receiptPath(receiptsDir, ticketId, headSha);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
