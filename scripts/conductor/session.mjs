// conductor/session.mjs — provider-limit-aware session runner + validator execution.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { STOPFILE, CONFIG, SESSION_MIN, DRY, log, sh, sleep } from './context.mjs';

// ---------- provider-limit-aware session runner ----------
export const LIMIT_RE = /(session limit|usage limit|rate.?limit|quota|overloaded|429|529)/i;
export const RESET_RE = /resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([ap]m)/i;

export function msUntilReset(text) {
  const m = text.match(RESET_RE);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  const t = new Date();
  t.setHours(h, Number(m[2]), 0, 0);
  if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
  return t.getTime() - Date.now() + 120_000;
}

export async function runSession(prompt, model, label, cwd) {
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
export function runValidators(wt, changed, names) {
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

