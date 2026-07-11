#!/usr/bin/env node
/**
 * conductor.mjs — unattended ticket executor for this repo's plan.json board.
 *
 * The M28 Conductor pattern: THE CONDUCTOR HOLDS THE GATES, NOT THE AGENTS.
 * Each ticket runs in a fresh `claude -p` session (untrusted); this script
 * verifies everything from outside the session (gates, write-scope, commits,
 * board state), runs an independent review session (maker ≠ verifier), and
 * only then merges. Survives provider session/usage limits by parsing the
 * reset time and sleeping until it.
 *
 *   node scripts/conductor.mjs [--waves W0,W1] [--breakpoint ticket|wave|never]
 *     [--models scripts/models.json] [--max-tickets N] [--session-minutes 45]
 *     [--no-merge] [--no-push] [--dry-run] [--escalate]
 *
 * Stop at any time: `touch STOP` in the repo root (checked between sessions).
 * Logs: docs/work/conductor-log.jsonl (machine) + stdout (human).
 * Standing approvals for unattended operation: docs/work/APPROVALS.md.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = resolve(ROOT, 'plan.json');
const LOG = resolve(ROOT, 'docs/work/conductor-log.jsonl');
const STOPFILE = resolve(ROOT, 'STOP');

// ---------- args ----------
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : dflt;
};
const WAVES = opt('waves', '') ? String(opt('waves', '')).split(',').map((s) => s.trim()) : null;
const BREAKPOINT = String(opt('breakpoint', 'never')); // ticket|wave|never
const MODELS = JSON.parse(readFileSync(resolve(ROOT, String(opt('models', 'scripts/models.json'))), 'utf8'));
const MAX_TICKETS = Number(opt('max-tickets', 999));
const SESSION_MIN = Number(opt('session-minutes', 45));
const DO_MERGE = !args.includes('--no-merge');
const DO_PUSH = !args.includes('--no-push');
const DRY = args.includes('--dry-run');
const ESCALATE = args.includes('--escalate'); // allow one attempt on MODELS.escalate after maker attempts fail

// ---------- utils ----------
const now = () => new Date().toISOString();
const log = (kind, data) => {
  const row = { ts: now(), kind, ...data };
  console.log(`[${row.ts}] ${kind}${data.ticket ? ` ${data.ticket}` : ''}${data.msg ? ` — ${data.msg}` : ''}`);
  try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, JSON.stringify(row) + '\n'); } catch {}
};
const sh = (cmd, cmdArgs, opts = {}) =>
  // 512MB buffer: git diffs on large tickets (e.g. the full expert-library import)
  // blow past execFileSync's 1MB default and throw ENOBUFS, killing the run.
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const git = (...a) => sh('git', a).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loadPlan = () => JSON.parse(readFileSync(PLAN, 'utf8'));
const wave = (id) => id.split('-')[0];

function globToRegex(glob) {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x01')
    .replace(/\*/g, '[^/]*')
    .replace(/\x01/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${esc}$`);
}
// Files any ticket may legitimately touch regardless of its write_scope. Two kinds:
//  (1) Shared ledgers the methodology mandates: the board (plan.json), the status
//      ledger (STATUS.md), work-dir notes (docs/work/**), and TECH_STACK.md where
//      CLAUDE.md Law 2 requires recording version deviations in the same commit.
//  (2) Root-level monorepo build config that many tickets extend as they add packages,
//      deps, and tests — the lockfile (any `pnpm install` regenerates it), workspace
//      + TS + lint + test-runner config, and ignore/version files. These are shared
//      INFRA, never another package's source: the globs below have no path separators,
//      so `package.json` matches only the ROOT one — `packages/x/package.json` still
//      requires x in the ticket's write_scope. Package/app SOURCE stays fully gated.
//  Serial-run safe; a parallel-berths executor would need lockfile-contention handling.
const ALWAYS_OK = [
  'plan.json', 'docs/STATUS.md', 'docs/work/**', 'docs/TECH_STACK.md',
  'pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml',
  'tsconfig.json', 'tsconfig.base.json', 'vitest.workspace.ts', 'vitest.config.ts',
  'playwright.config.ts', 'eslint.config.js', '.prettierrc.json',
  '.gitignore', '.npmrc', '.nvmrc',
].map(globToRegex);

function claimable(plan) {
  const done = new Set(plan.tickets.filter((t) => t.status === 'done').map((t) => t.id));
  const busyLanes = new Set(plan.tickets.filter((t) => t.status === 'in_progress').map((t) => t.lane));
  return plan.tickets
    .filter((t) => t.status === 'todo')
    .filter((t) => !WAVES || WAVES.includes(wave(t.id)))
    .filter((t) => t.depends_on.every((d) => done.has(d)))
    .filter((t) => !busyLanes.has(t.lane))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function pickModel(t) {
  if (MODELS.cheapLanes?.includes(t.lane) || t.points <= (MODELS.cheapMaxPoints ?? 0)) return MODELS.cheap;
  return MODELS.maker;
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
  return t.getTime() - Date.now() + 120_000; // +2 min margin
}

async function runSession(prompt, model, label) {
  let backoff = 5 * 60_000;
  for (let attempt = 1; attempt <= 12; attempt++) {
    if (existsSync(STOPFILE)) throw new Error('STOP file present');
    log('session.start', { label, model, attempt });
    if (DRY) return { out: '[dry-run] no session executed', code: 0 };
    const res = spawnSync('claude', ['-p', prompt, '--model', model, '--dangerously-skip-permissions'], {
      cwd: ROOT, encoding: 'utf8', timeout: SESSION_MIN * 60_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    if (res.signal) { log('session.timeout', { label, msg: `killed after ${SESSION_MIN}m (${res.signal})` }); return { out, code: 124 }; }
    if (res.status !== 0 && LIMIT_RE.test(out)) {
      const wait = msUntilReset(out) ?? Math.min(backoff, 60 * 60_000);
      backoff *= 2;
      log('limit.pause', { label, msg: `provider limit; sleeping ${(wait / 60000).toFixed(0)}m` });
      await sleep(wait);
      continue; // retry same session
    }
    return { out, code: res.status ?? 1 };
  }
  throw new Error('limit retries exhausted');
}

// ---------- gates (run OUTSIDE the session) ----------
function runGates(t, branch) {
  const gaps = [];
  const plan = loadPlan();
  const row = plan.tickets.find((x) => x.id === t.id);
  if (row.status !== 'done') gaps.push(`plan.json status is '${row.status}', expected 'done'`);
  const commits = git('rev-list', '--count', `main..${branch}`);
  if (Number(commits) < 1) gaps.push('no commits on ticket branch');
  const changed = git('diff', '--name-only', `main...${branch}`).split('\n').filter(Boolean);
  const scopeRes = t.write_scope.map(globToRegex);
  const outOfScope = changed.filter((f) => !scopeRes.some((r) => r.test(f)) && !ALWAYS_OK.some((r) => r.test(f)));
  if (outOfScope.length) gaps.push(`out-of-scope edits: ${outOfScope.join(', ')}`);
  if (existsSync(resolve(ROOT, 'package.json')) && !DRY) {
    for (const g of [['pnpm', ['lint']], ['pnpm', ['typecheck']], ['pnpm', ['test']]]) {
      try { sh(g[0], g[1], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 }); }
      catch (e) { gaps.push(`${g[0]} ${g[1][0]} failed: ${String(e.stdout || e.message).slice(-800)}`); }
    }
  }
  return gaps;
}

// ---------- prompts ----------
const codingPrompt = (t, feedback) => `Read CLAUDE.md, MASTER_PROMPT.md and PLAYBOOK.md in this repo and obey them.
You are working EXACTLY ONE ticket from plan.json and nothing else.

TICKET ${t.id} — ${t.title}
lane: ${t.lane} · write_scope: ${JSON.stringify(t.write_scope)}
acceptance:
${t.acceptance.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}
${feedback ? `\nA PREVIOUS ATTEMPT FAILED ITS GATES. You may be resuming partial work — inspect the current branch state first. Gate failures to fix:\n${feedback.map((g) => `- ${g}`).join('\n')}\n` : ''}
Rules of engagement:
- You are already on the correct git branch. Never switch branches, never touch main, never push.
- Set the ticket in_progress in plan.json first (commit), implement with tests per PLAYBOOK, stage explicit paths only, commit in small steps.
- Run the full gate yourself before closing (pnpm lint && pnpm typecheck && pnpm test when the toolchain exists).
- When everything passes: set the ticket done in plan.json + append the docs/STATUS.md line (same commit), then stop.
- If genuinely blocked after one honest attempt: set status blocked with a notes entry explaining exactly what is missing, then stop.
- An external conductor independently verifies your work; nothing you print is trusted, only repo state.`;

const reviewPrompt = (t, diff, prior = []) => `You are an independent code reviewer (you did NOT write this code). Review the diff for ticket ${t.id} — ${t.title}.
Acceptance criteria:\n${t.acceptance.map((a) => `- ${a}`).join('\n')}

Review dimensions: correctness vs acceptance; error handling (no swallowed errors); security (secrets, injection, trust-boundary violations — this project's law: agent sessions untrusted, receipts required, maker!=verifier; for crypto/hash/integrity code verify the primitive is actually sound — e.g. a tamper-evident hash preimage must be injective/domain-separated); tests real and failing-capable (no assertion-free tests, no gamed fixtures); write-scope respected; no dead code or stub theater; matches docs/ARCHITECTURE.md module rules.
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

// ---------- per-ticket flow ----------
async function executeTicket(t) {
  const branch = `feat/${t.id.toLowerCase()}-auto`;
  git('checkout', '-q', 'main');
  try { git('branch', '-D', branch); } catch {}
  git('checkout', '-q', '-b', branch);

  const attempts = [pickModel(t), pickModel(t), ...(ESCALATE ? [MODELS.escalate] : [])];
  let gaps = null;
  // Every HIGH/CRITICAL finding EVER raised on this ticket. A finding raised by
  // one review pass must be explicitly verified-resolved before merge — it can
  // never vanish just because a later (non-deterministic) reviewer instance
  // fails to re-mention it. This is the harness analogue of the Challenger gate:
  // findings are sticky and tracked to CONFIRMED-fixed, not re-derived each pass.
  const sticky = [];
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i > 0) {
      log('ticket.retry', { ticket: t.id, msg: `attempt ${i + 1} on ${model}` });
      resetStatusOnBranch(t.id);
    }
    await runSession(codingPrompt(t, gaps), model, `code:${t.id}`);
    if (DRY) return { ok: true, dry: true };
    gaps = runGates(t, branch);
    if (gaps.length) { log('gates.fail', { ticket: t.id, msg: gaps.join(' | ').slice(0, 400) }); continue; }

    // independent review, maker != verifier — prior findings carried in for re-verification
    const diff = git('diff', `main...${branch}`).slice(0, 180_000);
    const r = await runSession(reviewPrompt(t, diff, sticky), MODELS.reviewer, `review:${t.id}`);
    const verdict = parseJson(r.out) ?? { verdict: 'FIX', findings: [{ severity: 'HIGH', file: '-', issue: 'review output unparseable', fix: 're-run review' }], prior_status: [] };

    for (const f of (verdict.findings ?? []).filter((x) => ['CRITICAL', 'HIGH'].includes(x.severity))) {
      const key = `${f.file}:${f.issue}`;
      if (!sticky.some((s) => s.key === key)) sticky.push({ key, severity: f.severity, file: f.file, issue: f.issue, fix: f.fix, resolved: false });
    }
    for (const ps of verdict.prior_status ?? []) {
      const hit = sticky.find((s) => ps.finding && (s.key === ps.finding || (s.issue && ps.finding.includes(s.issue)) || (s.issue && s.issue.includes(ps.finding))));
      if (hit) hit.resolved = ps.status === 'RESOLVED';
    }
    const unresolved = sticky.filter((s) => !s.resolved);
    log('review.result', { ticket: t.id, msg: `verdict=${verdict.verdict} sticky=${sticky.length} unresolved=${unresolved.length}` });

    if (verdict.verdict === 'APPROVE' && unresolved.length === 0) {
      log('review.approve', { ticket: t.id, msg: `${sticky.length} finding(s) verified resolved` });
      return { ok: true, branch };
    }
    log('review.fix', { ticket: t.id, msg: `${unresolved.length} unresolved high/critical (sticky ${sticky.length})` });
    gaps = unresolved.map((s) => `[${s.severity}] ${s.file}: ${s.issue} — fix: ${s.fix}`);
  }
  // exhausted — block with the full unresolved-finding ledger so it's debuggable
  const ledger = sticky.filter((s) => !s.resolved).map((s) => `[UNRESOLVED ${s.severity}] ${s.file}: ${s.issue} — fix: ${s.fix}`);
  return { ok: false, branch, gaps: ledger.length ? ledger : gaps };
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// Reset a ticket's status to in_progress on the current branch so a stale
// blocked/done left by a prior attempt doesn't pre-fail the next attempt's gate.
function resetStatusOnBranch(id) {
  const plan = loadPlan();
  const row = plan.tickets.find((x) => x.id === id);
  if (!row || row.status === 'in_progress') return;
  row.status = 'in_progress';
  writeFileSync(PLAN, JSON.stringify(plan, null, 2) + '\n');
  try { git('add', 'plan.json'); git('commit', '-q', '-m', `chore(${id}): conductor resets status before retry`); } catch {}
}

function land(t, branch) {
  git('checkout', '-q', 'main');
  if (DO_MERGE) {
    git('merge', '--no-ff', '-q', '-m', `Merge ${branch}: ${t.id} ${t.title}\n\nConductor-verified: gates green + independent review APPROVE.\nStanding approval: docs/work/APPROVALS.md A-001.\n\nCo-Authored-By: Claude (conductor run) <noreply@anthropic.com>`, branch);
    git('branch', '-d', branch);
  } else {
    log('parked', { ticket: t.id, msg: `left on ${branch} for morning review (--no-merge)` });
  }
  if (DO_PUSH && DO_MERGE) {
    try { sh('git', ['push', 'github', 'main'], { timeout: 60_000 }); } catch (e) { log('push.fail', { ticket: t.id, msg: `github: ${e.message}` }); }
    try { sh('git', ['push', 'origin', 'main'], { timeout: 60_000 }); } catch { log('push.fail', { ticket: t.id, msg: 'origin (Gitea) unreachable — noted, continuing' }); }
  }
}

function markBlocked(t, gaps, branch) {
  git('checkout', '-q', 'main');
  const plan = loadPlan();
  const row = plan.tickets.find((x) => x.id === t.id);
  row.status = 'blocked';
  row.notes.push(`CONDUCTOR ${now()}: blocked after ${ESCALATE ? 3 : 2} attempts. Branch ${branch} kept. Gaps: ${gaps.join(' | ').slice(0, 600)}`);
  writeFileSync(PLAN, JSON.stringify(plan, null, 2) + '\n');
  git('add', 'plan.json'); git('commit', '-q', '-m', `chore(${t.id}): conductor marks blocked with evidence`);
  if (DO_PUSH) { try { sh('git', ['push', 'github', 'main']); } catch {} try { sh('git', ['push', 'origin', 'main']); } catch {} }
}

async function waveSecurityPass(w, baseSha) {
  const diff = git('diff', `${baseSha}..HEAD`).slice(0, 180_000);
  if (!diff) return;
  const r = await runSession(securityPrompt(w, diff), MODELS.security, `security:${w}`);
  const report = parseJson(r.out);
  const path = resolve(ROOT, `docs/work/SECURITY_${w}.md`);
  writeFileSync(path, `# Security pass — wave ${w} (${now()})\n\n\`\`\`json\n${JSON.stringify(report ?? { raw: r.out.slice(0, 4000) }, null, 2)}\n\`\`\`\n`);
  git('add', path); git('commit', '-q', '-m', `docs: security pass for wave ${w}`);
  if ((report?.critical?.length ?? 0) > 0) {
    log('security.critical', { msg: `wave ${w}: ${report.critical.length} CRITICAL — stopping for human review` });
    return 'STOP';
  }
}

// ---------- main ----------
async function main() {
  // preflight
  for (const bin of ['claude', 'git']) {
    try { sh('which', [bin]); } catch { console.error(`missing prerequisite: ${bin}`); process.exit(1); }
  }
  if (git('status', '--porcelain')) { console.error('working tree not clean — commit or stash first'); process.exit(1); }
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') git('checkout', '-q', 'main');
  log('conductor.start', { msg: `breakpoint=${BREAKPOINT} waves=${WAVES ?? 'all'} merge=${DO_MERGE} models=${JSON.stringify(MODELS)}` });

  let doneCount = 0;
  let currentWave = null;
  let waveBase = git('rev-parse', 'HEAD');

  while (doneCount < MAX_TICKETS) {
    if (existsSync(STOPFILE)) { log('conductor.stop', { msg: 'STOP file' }); break; }
    const next = claimable(loadPlan())[0];
    if (!next) { log('conductor.idle', { msg: 'nothing claimable (done or all blocked)' }); break; }

    if (currentWave && wave(next.id) !== currentWave) {
      const sec = await waveSecurityPass(currentWave, waveBase);
      if (sec === 'STOP') break;
      if (BREAKPOINT === 'wave') { log('conductor.breakpoint', { msg: `wave ${currentWave} complete` }); break; }
      waveBase = git('rev-parse', 'HEAD');
    }
    currentWave = wave(next.id);

    log('ticket.start', { ticket: next.id, msg: `${next.title} [${pickModel(next)}]` });
    const res = await executeTicket(next);
    if (DRY) { log('ticket.dry', { ticket: next.id }); break; }
    if (res.ok) {
      land(next, res.branch);
      doneCount++;
      log('ticket.done', { ticket: next.id, msg: `${doneCount} landed this run` });
      if (BREAKPOINT === 'ticket') { log('conductor.breakpoint', { msg: 'per-ticket breakpoint' }); break; }
    } else {
      markBlocked(next, res.gaps ?? ['unknown'], res.branch);
      log('ticket.blocked', { ticket: next.id });
    }
  }
  const plan = loadPlan();
  const counts = plan.tickets.reduce((m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m), {});
  log('conductor.end', { msg: `landed=${doneCount} board=${JSON.stringify(counts)}` });
}

main().catch((e) => { log('conductor.fatal', { msg: e.message }); process.exit(1); });
