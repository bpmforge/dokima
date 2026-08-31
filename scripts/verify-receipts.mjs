#!/usr/bin/env node
// verify-receipts.mjs — CLI face of the untrusted-verify-receipt wrapper (P0-01).
//
// Runs the project's declared verify commands (conductor.config.json
// `verifyCommands`) against the CURRENT HEAD of a working tree and writes the
// receipt to docs/work/receipts/<ticket>-<sha12>.json. Exists so a human, CI,
// or the conductor all mint evidence through the SAME code path — the agent
// session is the only party with no route here.
//
//   node scripts/verify-receipts.mjs --ticket P0-01 [--cwd <worktree>] [--check]
//
// --check: don't run anything; load the receipt for HEAD and assert it
//          (missing / stale-sha / nonzero all exit 1 with the gaps printed).

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintReceipt, receiptGaps, loadReceipt } from './conductor/receipts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function opt(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : dflt;
}

const ticketId = String(opt('ticket', ''));
if (!ticketId) { console.error('usage: node scripts/verify-receipts.mjs --ticket <id> [--cwd <dir>] [--check]'); process.exit(2); }
const cwd = resolve(String(opt('cwd', ROOT)));
const checkOnly = opt('check', false) === true;

// Config is read directly (not via conductor/context.mjs) so this CLI works
// in a bare checkout with no conductor flags parsed. Missing key -> [] and a
// loud message, never a silent pass.
let verifyCommands = [];
try {
  const cfg = JSON.parse(execFileSync('cat', [resolve(ROOT, 'conductor.config.json')], { encoding: 'utf8' }));
  verifyCommands = cfg.verifyCommands ?? [];
} catch { /* fall through to the empty-list guard below */ }
if (!verifyCommands.length) { console.error('conductor.config.json has no verifyCommands — nothing to attest'); process.exit(2); }

const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const receiptsDir = resolve(ROOT, 'docs/work/receipts');

if (checkOnly) {
  const gaps = receiptGaps(loadReceipt(receiptsDir, ticketId, headSha), headSha);
  if (gaps.length) { for (const g of gaps) console.error(`GAP: ${g}`); process.exit(1); }
  console.log(`receipt ok: ${ticketId} @ ${headSha.slice(0, 12)}`);
  process.exit(0);
}

const { receipt, path } = mintReceipt({ ticketId, wt: cwd, headSha, commands: verifyCommands, receiptsDir });
const gaps = receiptGaps(receipt, headSha);
console.log(`receipt written: ${path}`);
for (const c of receipt.commands) console.log(`  ${c.exitCode === 0 ? 'ok  ' : 'FAIL'} ${c.command} (${c.durationMs}ms)`);
if (gaps.length) { for (const g of gaps) console.error(`GAP: ${g.split('\n')[0]}`); process.exit(1); }
