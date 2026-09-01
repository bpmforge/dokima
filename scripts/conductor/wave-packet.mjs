// conductor/wave-packet.mjs — the wave review packet (P3-04's surviving half).
//
// The 2-4h bounded human review artifact: diff stat, consensus tiers from the
// Tier-A panel, and the landing's own log rows — written beside the evidence.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * P6-13: the P3-04 merge train (trainStepCheck/trainPreamble/runMergeTrain/
 * verifyMainAncestry) was DELETED here per the W21-36 doctrine — documented-
 * dead code passes every mechanical check a live path passes. P6-02's ONE
 * synthetic merge superseded member-ordered trains; only the packet writer
 * below ever gained a production caller (feature-landing-wiring.mjs).
 */
export function writeWavePacket({ record, tiers, logRows, outDir, gitRun }) {
  mkdirSync(outDir, { recursive: true });
  const stat = gitRun(['diff', '--stat', `${record.baseSha}..${record.headSha}`]);
  const lines = [];
  lines.push(`# Wave review packet — ${record.branch}`);
  lines.push('');
  lines.push(
    `Synthetic head \`${record.headSha.slice(0, 12)}\` over base \`${record.baseSha.slice(0, 12)}\` — ${record.merged.length} member(s), sized for a 2-4h review session. This is the machine-stop line: the automation merged nothing past this point without the checks below being green.`,
  );
  lines.push('');
  lines.push(`## Members`);
  for (const m of record.merged) lines.push(`- ${m.id} @ \`${m.headSha.slice(0, 12)}\``);
  if (record.conflicted?.length) {
    lines.push('', '## Excluded (merge conflicts — not hand-resolved)');
    for (const c of record.conflicted) lines.push(`- ${c.id}: ${c.reason}`);
  }
  lines.push(
    '',
    '## Findings (Tier A, advisory — deterministic gates decided the merge)',
  );
  for (const tier of ['actOn', 'consider', 'noted']) {
    const rows = tiers?.[tier] ?? [];
    lines.push(`### ${tier} (${rows.length})`);
    for (const f of rows)
      lines.push(
        `- [${f.severity}] ${f.file} — ${f.issue} (${(f.reviewers ?? []).join('+')}; ${f.attributedTo ?? 'wave'}; ${f.id ?? ''})`,
      );
  }
  if (tiers?.dismissed?.length) {
    lines.push(`### dismissed (${tiers.dismissed.length} — citations did not resolve)`);
    for (const d of tiers.dismissed)
      lines.push(`- ${d.file ?? '(no file)'} — ${String(d.issue ?? '').slice(0, 120)}`);
  }
  lines.push('', '## Aggregate diff stat', '```', stat.trim(), '```');
  lines.push('', '## Wave log slice');
  for (const r of logRows ?? [])
    lines.push(`- ${r.ts} ${r.kind}${r.ticket ? ` [${r.ticket}]` : ''} ${r.msg ?? ''}`);
  const path = resolve(outDir, 'WAVE_PACKET.md');
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

/** Post-train smoke: one main-branch verify pass; Done transitions only on verified main ancestry. */
