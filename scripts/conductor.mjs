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

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  loadConfigFile,
  loadPlanFrom,
  writePlan,
  wave,
  nonWildPrefix,
  globToRegex,
  parseJson,
  alwaysOkPatterns,
  doneCheckGap,
  codingPrompt,
  validateModels,
  nodePinMismatch,
  claimableTickets,
  testSiblingWarning,
  migrationCollisions,
} from './conductor-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = resolve(ROOT, 'docs/work/conductor-log.jsonl');
const STOPFILE = resolve(ROOT, 'STOP');

// ---------- config (project-specific; script stays repo-agnostic) ----------
// A malformed conductor.config.json (e.g. hand-edited, trailing comma) is
// caught here and turned into a startup error naming the file and the
// parser's own reason, not a raw SyntaxError stack from the module job.
const CONFIG = (() => {
  try {
    return loadConfigFile(ROOT, DEFAULT_CONFIG);
  } catch (e) {
    console.error(`conductor: ${e.message}\nFix conductor.config.json's JSON syntax, or delete the file to use built-in defaults.`);
    process.exit(1);
  }
})();
const WT_BASE = resolve(ROOT, CONFIG.worktreeDir);

// ---------- model routing (W9-12: config-only, no separate file) ----------
// Was a bare `readFileSync(scripts/models.json)` at module scope — a repo
// importing the conductor without that file crashed with a raw ENOENT stack
// at IMPORT time, before --lint or any argument parsing ran. Now it's part
// of CONFIG (already merged above), so a missing config falls back to
// DEFAULT_CONFIG.models cleanly. A malformed `models` value still needs a
// startup check — an actionable message here beats a wrong-model surprise
// deep inside a session run later.
const MODELS = CONFIG.models;
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
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : dflt;
};
const WAVES = opt('waves', '') ? String(opt('waves', '')).split(',').map((s) => s.trim()) : null;
const BREAKPOINT = String(opt('breakpoint', 'never'));
const MAX_TICKETS = Number(opt('max-tickets', 999));
const SESSION_MIN = Number(opt('session-minutes', 45));
const DO_MERGE = !args.includes('--no-merge');
const DO_PUSH = !args.includes('--no-push');
const DRY = args.includes('--dry-run');
const ESCALATE = args.includes('--escalate');
const LINT_ONLY = args.includes('--lint');

// ---------- utils ----------
const now = () => new Date().toISOString();
const log = (kind, data) => {
  const row = { ts: now(), kind, ...data };
  console.log(`[${row.ts}] ${kind}${data.ticket ? ` ${data.ticket}` : ''}${data.msg ? ` — ${data.msg}` : ''}`);
  // Best-effort durable audit trail; console.log above already surfaced this
  // event, so a failed write here (disk full, permissions) is not fatal.
  try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, JSON.stringify(row) + '\n'); } catch { /* intentional: see comment above */ }
};
const sh = (cmd, cmdArgs, opts = {}) =>
  // 512MB buffer: git diffs on large tickets blow past execFileSync's 1MB default (ENOBUFS).
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const git = (...a) => sh('git', a).trim();               // runs in ROOT (stays on main)
const gitIn = (dir, ...a) => sh('git', a, { cwd: dir }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loadPlan = (dir = ROOT) => loadPlanFrom(dir, CONFIG.boardPath);

// Shared infra any ticket may touch regardless of write_scope (config-driven);
// always includes CONFIG.boardPath even if a project's alwaysOk override omits it.
const ALWAYS_OK = alwaysOkPatterns(CONFIG).map(globToRegex);

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
function parkedBranchIds() {
  if (DO_MERGE) return []; // merged runs delete the branch; nothing to protect
  const ids = [];
  for (const b of git('for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n')) {
    if (!b || !b.startsWith(CONFIG.branchPrefix)) continue;
    try {
      if (Number(git('rev-list', '--count', `main..${b}`)) > 0) {
        ids.push(b.slice(CONFIG.branchPrefix.length).toUpperCase());
      }
    } catch { /* branch vanished between listing and counting */ }
  }
  return ids;
}

function claimable(plan, excluded = []) {
  const parked = parkedBranchIds();
  if (parked.length) log('claim.skip-parked', { msg: `already parked with commits: ${parked.join(', ')}` });
  return claimableTickets(plan, { waves: WAVES, hold: CONFIG.holdTickets ?? [], excluded: [...excluded, ...parked] });
}

function pickModel(t) {
  if (MODELS.cheapLanes?.includes(t.lane) || t.points <= (MODELS.cheapMaxPoints ?? 0)) return MODELS.cheap;
  return MODELS.maker;
}

// ---------- plan linter (preflight; catches bad tickets before a run) ----------
function lintPlan(plan) {
  const errors = [], warnings = [];
  if (CONFIG.migrationVersions?.pattern) {
    const onDisk = (CONFIG.migrationVersions.dirs || []).flatMap((d) => {
      try { return sh('git', ['ls-files', d]).split('\n').map((f) => new RegExp(CONFIG.migrationVersions.pattern).exec(f)).filter(Boolean).map((m) => m[1]); }
      catch { return []; }
    });
    warnings.push(...migrationCollisions(plan.tickets, CONFIG.migrationVersions, onDisk));
  }
  const ids = new Set(plan.tickets.map((t) => t.id));
  for (const t of plan.tickets) {
    for (const k of ['id', 'title', 'lane', 'write_scope', 'depends_on', 'acceptance', 'status']) {
      if (t[k] === undefined) errors.push(`${t.id || '?'}: missing '${k}'`);
    }
    if (t.write_scope && !t.write_scope.length) errors.push(`${t.id}: empty write_scope`);
    { const w = testSiblingWarning(t, CONFIG.testSibling); if (w) warnings.push(w); }
    if (t.acceptance && !t.acceptance.length) errors.push(`${t.id}: empty acceptance`);
    for (const d of t.depends_on || []) if (!ids.has(d)) errors.push(`${t.id}: depends_on unknown ticket '${d}'`);

    // High-value heuristic: acceptance names a source path that no write_scope glob
    // (nor the shared-infra allowlist) can cover — the exact defect that blocked
    // W0-01 (pnpm-lock) and W0-05 (migrations dir excluded from its own scope).
    const scopeRe = (t.write_scope || []).map(globToRegex);
    const scopePfx = (t.write_scope || []).map(nonWildPrefix);
    const scopeTop = new Set((t.write_scope || []).map((g) => g.split('/')[0]));
    const text = (t.acceptance || []).join(' ');
    const paths = [...text.matchAll(/([\w.-]+(?:\/[\w.*-]+)+\.[a-z]{2,4})/g)].map((m) => m[1]);
    for (const p of [...new Set(paths)]) {
      if (p.startsWith('docs/') || p.startsWith('.')) continue; // docs + dotpaths are shared/runtime, not deliverables
      // Only flag a path that lives in the ticket's OWN top-level territory but that
      // its globs can't cover — the "gap in my own scope" pattern (W0-05 class),
      // not an incidental path mention from elsewhere in the tree.
      if (!scopeTop.has(p.split('/')[0])) continue;
      const covered = scopeRe.some((r) => r.test(p)) || ALWAYS_OK.some((r) => r.test(p)) || scopePfx.some((pfx) => pfx && p.startsWith(pfx));
      if (!covered) warnings.push(`${t.id}: acceptance names '${p}' in its own area but no write_scope glob covers it`);
    }
  }
  // dependency cycle detection
  const deps = new Map(plan.tickets.map((t) => [t.id, t.depends_on || []]));
  const state = new Map();
  const visit = (n, stack) => {
    if (stack.has(n)) { errors.push(`dependency cycle: ${[...stack, n].join(' -> ')}`); return; }
    if (state.get(n)) return;
    state.set(n, true);
    for (const d of deps.get(n) || []) if (ids.has(d)) visit(d, new Set([...stack, n]));
  };
  for (const id of ids) visit(id, new Set());
  return { errors, warnings };
}

// ---------- provider-limit-aware session runner ----------
const LIMIT_RE = /(session limit|usage limit|rate.?limit|quota|overloaded|429|529)/i;
const RESET_RE = /resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([ap]m)/i;

function msUntilReset(text) {
  const m = text.match(RESET_RE);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  const t = new Date();
  t.setHours(h, Number(m[2]), 0, 0);
  if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
  return t.getTime() - Date.now() + 120_000;
}

async function runSession(prompt, model, label, cwd) {
  let backoff = 5 * 60_000;
  for (let attempt = 1; attempt <= 12; attempt++) {
    if (existsSync(STOPFILE)) throw new Error('STOP file present');
    log('session.start', { label, model, attempt });
    if (DRY) return { out: '[dry-run] no session executed', code: 0 };
    const res = spawnSync('claude', ['-p', prompt, '--model', model, '--dangerously-skip-permissions'], {
      cwd, encoding: 'utf8', timeout: SESSION_MIN * 60_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    if (res.signal) { log('session.timeout', { label, msg: `killed after ${SESSION_MIN}m (${res.signal})` }); return { out, code: 124 }; }
    if (res.status !== 0 && LIMIT_RE.test(out)) {
      const wait = msUntilReset(out) ?? Math.min(backoff, 60 * 60_000);
      backoff *= 2;
      log('limit.pause', { label, msg: `provider limit; sleeping ${(wait / 60000).toFixed(0)}m` });
      await sleep(wait);
      continue;
    }
    return { out, code: res.status ?? 1 };
  }
  throw new Error('limit retries exhausted');
}

// Run named validators from content/validators in the worktree. Each emits a JSON
// summary line: {validator,gaps,exit,items:[{category,detail}]}. Findings are
// DIFF-SCOPED to files this ticket changed — a ticket answers for its own diff,
// not the repo's pre-existing debt (and it keeps unrelated validator noise out).
function runValidators(wt, changed, names) {
  const dir = CONFIG.validators?.dir ?? 'content/validators';
  const out = [];
  for (const name of names || []) {
    const script = resolve(wt, dir, `${name}.sh`);
    if (!existsSync(script)) continue;
    let raw = '';
    try { raw = sh('bash', [script, '.'], { cwd: wt, timeout: 5 * 60_000 }); }
    catch (e) { raw = String(e.stdout || ''); } // validator exits 1 on gaps -> throws; JSON is on stdout
    const line = raw.split('\n').find((l) => l.includes(`"validator":"${name}"`));
    if (!line) continue;
    let parsed; try { parsed = JSON.parse(line); } catch { continue; }
    for (const it of parsed.items || []) {
      if (it.detail && changed.some((f) => it.detail.includes(f))) {
        out.push(`[${name}${it.category ? ':' + it.category : ''}] ${it.detail}`.slice(0, 280));
      }
    }
  }
  return out;
}

// ---------- gates (run OUTSIDE the session, in the ticket's worktree) ----------
function runGates(t, branch, wt) {
  const gaps = [];
  const row = loadPlan(wt).tickets.find((x) => x.id === t.id);
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
    for (const [cmd, cmdArgs] of CONFIG.gates) {
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

// ---------- prompts ----------
// codingPrompt lives in conductor-lib.mjs (pure string templating, unit-tested
// there); called below with CONFIG.boardPath so the agent is told the real
// board location.

const reviewPrompt = (t, diff, prior = [], advisory = []) => `You are an independent code reviewer (you did NOT write this code). Review the diff for ticket ${t.id} — ${t.title}.
Acceptance criteria:\n${t.acceptance.map((a) => `- ${a}`).join('\n')}

Review dimensions: correctness vs acceptance; error handling (no swallowed errors); security (secrets, injection, trust-boundary violations — this project's law: agent sessions untrusted, receipts required, maker!=verifier; for crypto/hash/integrity code verify the primitive is actually sound — e.g. a tamper-evident hash preimage must be injective/domain-separated); tests real and failing-capable (no assertion-free tests, no gamed fixtures); write-scope respected; no dead code or stub theater; matches docs/ARCHITECTURE.md module rules.
${advisory.length ? `\nDETERMINISTIC VALIDATOR FINDINGS on this diff (grep-heuristic — some are false positives, e.g. numbers inside comments/strings/status-codes, or "unreachable" on valid early-return code). ADJUDICATE each: is it a REAL defect worth a finding, or a false positive? Only raise the real ones:\n${advisory.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n` : ''}
${prior.length ? `\nPRIOR HIGH/CRITICAL FINDINGS raised on EARLIER attempts of THIS ticket. You MUST inspect the current diff and judge each one — a finding is NOT resolved merely because you would not raise it yourself; verify in the code that it was actually fixed:\n${prior.map((s, i) => `  ${i + 1}. [${s.severity}] ${s.file}: ${s.issue}`).join('\n')}\n` : ''}
Respond with ONLY a JSON object:
{"verdict":"APPROVE"|"FIX",
 "findings":[{"severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","file":"...","issue":"...","fix":"..."}],
 "prior_status":[{"finding":"<the issue text from the numbered list above>","status":"RESOLVED"|"PRESENT","evidence":"why — cite the code that fixes or still exhibits it"}]}
Include a prior_status entry for EVERY prior finding listed. Verdict FIX if any CRITICAL/HIGH is present in the new code OR any prior finding is not RESOLVED. Be specific; cite files.

DIFF:
${diff}`;

const securityPrompt = (w, diff) => `You are a security auditor. Audit the combined diff of wave ${w} of this project against: OWASP relevant classes, hardcoded secrets, command/path injection (this app spawns child processes and shells out to git), trust-boundary violations (agent-session outputs must never directly mutate state; receipts required), unsafe deserialization, and dependency risks. Respond with ONLY JSON: {"critical":[...],"high":[...],"medium":[...],"notes":"..."} where each item is {"file":"...","issue":"...","fix":"..."}.

DIFF:
${diff}`;

// ---------- worktree lifecycle ----------
function makeWorktree(t) {
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
function removeWorktree(wt) {
  // Best-effort teardown after landing/blocking a ticket; the worktree may
  // already be gone (e.g. a re-run after a partial failure).
  try { git('worktree', 'remove', '--force', wt); } catch { /* intentional: worktree already removed */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* intentional: dir already gone */ }
}

// ---------- per-ticket flow ----------
async function executeTicket(t) {
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
    const currentHigh = (verdict.findings ?? []).filter((x) => ['CRITICAL', 'HIGH'].includes(x.severity));
    for (const f of currentHigh) {
      const key = `${f.file}:${f.issue}`;
      if (!sticky.some((s) => s.key === key)) sticky.push({ key, severity: f.severity, file: f.file, issue: f.issue, fix: f.fix });
    }
    const presentPriors = (verdict.prior_status ?? []).filter((ps) => ps.status === 'PRESENT');
    const blockers = [
      ...currentHigh.map((f) => `[${f.severity}] ${f.file}: ${f.issue} — fix: ${f.fix}`),
      ...presentPriors.map((ps) => `[STILL-PRESENT] ${ps.finding} — ${ps.evidence || ''}`),
    ];
    log('review.result', { ticket: t.id, msg: `verdict=${verdict.verdict} newHigh=${currentHigh.length} priorsStillPresent=${presentPriors.length} (sticky-seen ${sticky.length})` });

    if (verdict.verdict === 'APPROVE' && blockers.length === 0) {
      log('review.approve', { ticket: t.id, msg: `informed APPROVE; ${sticky.length} prior finding(s) not re-raised` });
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
function resetStatus(wt, id) {
  const plan = loadPlan(wt);
  const row = plan.tickets.find((x) => x.id === id);
  if (!row || row.status === 'in_progress') return;
  row.status = 'in_progress';
  writePlan(wt, plan, CONFIG.boardPath);
  // Best-effort: if nothing changed to commit (e.g. status was already reset
  // on a prior pass), git exits non-zero — not an error worth surfacing here.
  try { gitIn(wt, 'add', CONFIG.boardPath); gitIn(wt, 'commit', '-q', '-m', `chore(${id}): conductor resets status before retry`); } catch { /* intentional: nothing to commit */ }
}

function pushRemotes(ticket, extraBranch = null) {
  if (!DO_PUSH) return;
  // `extraBranch` is the ticket's own branch, pushed alongside main. Without it
  // a blocked ticket's evidence branch and a --no-merge parked branch only ever
  // existed on this machine: pushRemotes pushed main, and main is exactly what
  // does NOT contain them. Kryptkeeper 2026-07-28 ran for an hour with every
  // completed and every blocked branch unreplicated.
  const refs = ['main', ...(extraBranch ? [extraBranch] : [])];
  for (const rem of CONFIG.remotes) {
    for (const ref of refs) {
      try { sh('git', ['push', rem, ref], { timeout: 60_000 }); }
      catch (e) { log('push.fail', { ticket, msg: `${rem} ${ref}: ${String(e.message).slice(0, 80)}` }); }
    }
  }
}

function land(t, branch, wt) {
  // ROOT stays on main throughout — just merge the branch and clean up the worktree.
  if (DO_MERGE) {
    try {
      git('merge', '--no-ff', '-q', '-m', `Merge ${branch}: ${t.id} ${t.title}\n\nConductor-verified: gates green + independent review APPROVE (sticky findings all resolved).\nStanding approval: docs/work/APPROVALS.md A-001.\n\nCo-Authored-By: Claude (conductor run) <noreply@anthropic.com>`, branch);
    } catch {
      // Merge conflict (main moved since the branch forked — L-30): NEVER fatal here.
      // A fatal crashes the conductor, and the supervisor's cleanup then deletes the
      // finished, reviewed branch (the W4-01 incident). Abort, preserve the branch
      // outside the sw/ cleanup namespace, park the ticket for human integration.
      try { git('merge', '--abort'); } catch { /* intentional: no in-progress merge to abort */ }
      markBlocked(t, [`merge conflict vs moved main — reviewed work preserved (gates+review already green); human integrates`], branch, wt);
      return;
    }
    removeWorktree(wt);
    // Best-effort: branch may already be gone (e.g. re-run after a partial land).
    try { git('branch', '-d', branch); } catch { /* intentional: branch already deleted */ }
    // If the merge touched any package.json, ROOT's node_modules is now stale —
    // re-link workspace deps so a subsequent test on ROOT (e.g. the stop-hook's
    // `npm test`) doesn't hit "Cannot find package @shipwright/*" (L-40).
    try {
      const merged = git('diff', '--name-only', 'HEAD~1', 'HEAD');
      if (/(^|\/)package\.json$/m.test(merged)) {
        const [bin, args] = CONFIG.install;
        sh(bin, args, { cwd: ROOT });
        log('land.install', { ticket: t.id, msg: 'package.json changed — re-linked ROOT workspace deps' });
      }
    } catch (err) { log('land.install.warn', { ticket: t.id, msg: String(err).slice(0, 200) }); }
    pushRemotes(t.id);
  } else {
    log('parked', { ticket: t.id, msg: `left on ${branch} (worktree ${wt}) for review (--no-merge)` });
    // Push the parked branch: it holds finished, gate-green, review-approved
    // work that main will not carry until a human merges it.
    pushRemotes(t.id, branch);
    return 'parked';
  }
  return 'merged';
}

function markBlocked(t, gaps, branch, wt) {
  // Block status is recorded on main (ROOT); the branch is kept for inspection, worktree removed.
  const plan = loadPlan();
  const row = plan.tickets.find((x) => x.id === t.id);
  row.status = 'blocked';
  // notes is historically string-or-array (review-pass tickets use strings) — normalize.
  if (!Array.isArray(row.notes)) row.notes = row.notes ? [row.notes] : [];
  row.notes.push(`CONDUCTOR ${now()}: blocked after ${ESCALATE ? 3 : 2} attempts. Branch ${branch} kept. Gaps: ${gaps.join(' | ').slice(0, 600)}`);
  writePlan(ROOT, plan, CONFIG.boardPath);
  git('add', CONFIG.boardPath); git('commit', '-q', '-m', `chore(${t.id}): conductor marks blocked with evidence`);
  removeWorktree(wt);
  // Rename the kept evidence branch OUT of the sw/ namespace: supervise.sh's crash
  // cleanup deletes sw/* branches on every restart, which was silently destroying
  // blocked tickets' "Branch kept" evidence (LESSONS L-16). Unique-suffix on
  // collision — a re-blocked ticket must not leave attempt 2 in the kill-zone.
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  let keepName = `blocked/${t.id.toLowerCase()}`;
  try { git('rev-parse', '--verify', keepName); keepName = `${keepName}-${stamp}`; } catch { /* free */ }
  try { git('branch', '-m', branch, keepName); } catch { /* branch may not exist */ }
  pushRemotes(t.id, keepName);
}

// ---------- human-signed security waivers ----------
function loadSecurityWaivers() {
  const f = resolve(ROOT, 'docs/work/SECURITY_WAIVERS.md');
  if (!existsSync(f)) return [];
  const AGENT = /^(agent|claude|ai|assistant|conductor|bot|gpt|opus|sonnet|haiku)$/i;
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => /^\|\s*SW-\d/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((c) => c.length >= 7)
    .map((c) => ({ id: c[1], date: c[2], signedBy: c[3], fileMatch: c[4], issueMatch: c[5], reason: c[6] }))
    .filter((wv) => wv.fileMatch && wv.signedBy && !AGENT.test(wv.signedBy));
}
function matchWaiver(critical, waivers) {
  const file = String(critical.file ?? '').toLowerCase();
  const issue = String(critical.issue ?? '').toLowerCase();
  return waivers.find((wv) => file.includes(wv.fileMatch.toLowerCase()) && issue.includes((wv.issueMatch || '').toLowerCase()));
}

async function waveSecurityPass(w, baseSha) {
  const diff = git('diff', `${baseSha}..HEAD`).slice(0, 180_000);
  if (!diff) return;
  const r = await runSession(securityPrompt(w, diff), MODELS.security, `security:${w}`, ROOT);
  const report = parseJson(r.out);
  const path = resolve(ROOT, `docs/work/SECURITY_${w}.md`);
  writeFileSync(path, `# Security pass — wave ${w} (${now()})\n\n\`\`\`json\n${JSON.stringify(report ?? { raw: r.out.slice(0, 4000) }, null, 2)}\n\`\`\`\n`);
  git('add', path); git('commit', '-q', '-m', `docs: security pass for wave ${w}`);
  const waivers = loadSecurityWaivers();
  const crits = report?.critical ?? [];
  const active = crits.filter((c) => !matchWaiver(c, waivers));
  for (const c of crits.filter((c) => matchWaiver(c, waivers))) {
    const wv = matchWaiver(c, waivers);
    log('security.waived', { msg: `wave ${w}: CRITICAL waived by ${wv.id} (signed ${wv.signedBy}): ${String(c.issue).slice(0, 70)}` });
  }
  if (active.length > 0) {
    log('security.critical', { msg: `wave ${w}: ${active.length} unwaived CRITICAL — stopping for human review` });
    return 'STOP';
  }
}

// ---------- main ----------
async function main() {
  // plan lint — always, and exit early on --lint
  const { errors, warnings } = lintPlan(loadPlan());
  for (const w of warnings) log('lint.warn', { msg: w });
  if (errors.length) { for (const e of errors) log('lint.error', { msg: e }); if (!DRY) { console.error(`${CONFIG.boardPath} has ${errors.length} lint error(s) — fix before running`); process.exit(2); } }
  if (LINT_ONLY) { log('lint.done', { msg: `${errors.length} error(s), ${warnings.length} warning(s)` }); process.exit(errors.length ? 2 : 0); }

  for (const bin of ['claude', 'git']) {
    try { sh('which', [bin]); } catch { console.error(`missing prerequisite: ${bin}`); process.exit(1); }
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
        console.error(`${mismatch} (pinned by ${CONFIG.nvmrcPath}) — fix PATH/fnm before running (W3-15)`);
        process.exit(1);
      }
    }
  }
  if (CONFIG.holdTickets?.length) log('conductor.hold', { msg: `human-pair hold (F2): ${CONFIG.holdTickets.join(', ')} — never claimed unattended` });
  if (git('status', '--porcelain')) { console.error('working tree not clean — commit or stash first'); process.exit(1); }
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') git('checkout', '-q', 'main');
  log('conductor.start', { msg: `breakpoint=${BREAKPOINT} waves=${WAVES ?? 'all'} isolation=${CONFIG.isolation} merge=${DO_MERGE} models=${JSON.stringify(MODELS)}` });

  let doneCount = 0;
  // Tickets parked by --no-merge: done on their branch, still `todo` on the
  // board at ROOT. Must not be re-claimed, or the loop never terminates and
  // each re-claim resets the parked branch. See claimableTickets().
  const parkedThisRun = new Set();
  let currentWave = null;
  let waveBase = git('rev-parse', 'HEAD');

  while (doneCount < MAX_TICKETS) {
    if (existsSync(STOPFILE)) { log('conductor.stop', { msg: 'STOP file' }); break; }
    const next = claimable(loadPlan(), parkedThisRun)[0];
    if (!next) { log('conductor.idle', { msg: 'nothing claimable (done or all blocked)' }); break; }

    if (currentWave && wave(next.id) !== currentWave) {
      const sec = await waveSecurityPass(currentWave, waveBase);
      if (sec === 'STOP') break;
      if (BREAKPOINT === 'wave') { log('conductor.breakpoint', { msg: `wave ${currentWave} complete` }); break; }
      waveBase = git('rev-parse', 'HEAD');
    }
    currentWave = wave(next.id);

    if (DRY) { log('ticket.dry', { ticket: next.id, msg: `${next.title} [${pickModel(next)}]` }); break; }
    log('ticket.start', { ticket: next.id, msg: `${next.title} [${pickModel(next)}]` });
    const res = await executeTicket(next);
    if (res.ok) {
      if (land(next, res.branch, res.wt) === 'parked') parkedThisRun.add(next.id);
      doneCount++;
      log('ticket.done', { ticket: next.id, msg: `${doneCount} landed this run` });
      if (BREAKPOINT === 'ticket') { log('conductor.breakpoint', { msg: 'per-ticket breakpoint' }); break; }
    } else {
      markBlocked(next, res.gaps ?? ['unknown'], res.branch, res.wt);
      log('ticket.blocked', { ticket: next.id });
    }
  }
  const counts = loadPlan().tickets.reduce((m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m), {});
  log('conductor.end', { msg: `landed=${doneCount} board=${JSON.stringify(counts)}` });
}

main().catch((e) => { log('conductor.fatal', { msg: e.message }); process.exit(1); });
