// conductor/security.mjs — per-wave security pass with human-signed waivers.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseJson } from '../conductor-lib.mjs';
import { ROOT, MODELS, now, log, git } from './context.mjs';
import { securityPrompt } from './prompts.mjs';
import { runSession } from './session.mjs';

// ---------- human-signed security waivers ----------
export function loadSecurityWaivers() {
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
export function matchWaiver(critical, waivers) {
  const file = String(critical.file ?? '').toLowerCase();
  const issue = String(critical.issue ?? '').toLowerCase();
  return waivers.find((wv) => file.includes(wv.fileMatch.toLowerCase()) && issue.includes((wv.issueMatch || '').toLowerCase()));
}

export async function waveSecurityPass(w, baseSha) {
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

