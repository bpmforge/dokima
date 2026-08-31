// conductor/wave-packet.mjs — Level-3 merge train + the bounded human review
// packet (P3-04).
//
// The train merges wave members in dependency order, and before EACH merge it
// re-checks ancestor compatibility: the tested synthetic head must still be
// exactly (current main + the remaining member heads). Anything moved — main
// advanced under the train, or a member amended — stops the train BEFORE the
// merge, not after; the wave gate's verdict only covers what it actually
// tested (the OPT-09 rule, enforced at the last possible moment).
//
// The packet is the machine-stop line (M-03): a curated diff + the wave's
// log slice + the findings summary, sized for a 2-4h human session — never
// "read the repo."

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Pre-merge compatibility check for the NEXT member: valid only when
 *  (a) main is still the base the synthetic was built on (or only earlier
 *      train merges advanced it — their heads are recorded), and
 *  (b) the member's branch head equals the head the wave tested.
 * gitRun injected.
 */
export function trainStepCheck({ record, memberId, mergedSoFar, gitRun }) {
  const member = (record.merged ?? []).find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: `${memberId} is not part of the tested wave` };
  const nowHead = gitRun([
    'rev-parse',
    member.branchRef ?? `sw/${memberId.toLowerCase()}`,
  ]).trim();
  if (nowHead !== member.headSha) {
    return {
      ok: false,
      reason: `${memberId} moved after the wave passed (${member.headSha.slice(0, 8)} -> ${nowHead.slice(0, 8)}) — only this member and downstream synthetic results invalidate`,
    };
  }
  const mainSha = gitRun(['rev-parse', 'main']).trim();
  const expected = mergedSoFar.length
    ? mergedSoFar[mergedSoFar.length - 1].postMergeSha
    : record.baseSha;
  if (mainSha !== expected) {
    return {
      ok: false,
      reason: `main advanced under the train (${expected?.slice(0, 8)} -> ${mainSha.slice(0, 8)}) — the synthetic head no longer describes main + remaining members`,
    };
  }
  return { ok: true };
}

/**
 * Tier-D preamble (wires P3-02): the train may not START while any seam gap is
 * open on the tested synthetic head — an unchecked or failed seam means the
 * wave gate's "green" did not cover integration, and the train would launder
 * that gap onto main one member at a time.
 */
export function trainPreamble({ seamGaps = [] }) {
  if (seamGaps.length) {
    return {
      ok: false,
      reason: `Tier-D seam gate open: ${seamGaps.length} gap(s) — first: ${String(seamGaps[0]).split('\n')[0]}`,
    };
  }
  return { ok: true };
}

/** Merge members in dependency order with the per-step check; stops at the first incompatibility. */
export function runMergeTrain({ record, order, gitRun, log = () => {}, seamGaps = [] }) {
  const pre = trainPreamble({ seamGaps });
  if (!pre.ok) {
    log('train.refused', { msg: pre.reason });
    return {
      merged: [],
      halted: [{ id: '(preamble)', reason: pre.reason }],
      complete: false,
    };
  }
  const mergedSoFar = [];
  const halted = [];
  for (const id of order) {
    const chk = trainStepCheck({ record, memberId: id, mergedSoFar, gitRun });
    if (!chk.ok) {
      halted.push({ id, reason: chk.reason });
      log('train.halt', { ticket: id, msg: chk.reason });
      break; // downstream members depend on the halted state — never skip ahead
    }
    const member = record.merged.find((m) => m.id === id);
    gitRun([
      'merge',
      '--no-ff',
      '-q',
      '-m',
      `Merge wave member ${id} (tested at synthetic ${record.headSha.slice(0, 8)})`,
      member.branchRef ?? `sw/${id.toLowerCase()}`,
    ]);
    const postMergeSha = gitRun(['rev-parse', 'main']).trim();
    mergedSoFar.push({ id, postMergeSha });
    log('train.merged', { ticket: id, msg: `-> main @ ${postMergeSha.slice(0, 8)}` });
  }
  return {
    merged: mergedSoFar,
    halted,
    complete: halted.length === 0 && mergedSoFar.length === order.length,
  };
}

/**
 * The bounded human review packet: curated diff stat + per-member summaries +
 * findings tiers + the wave's own log slice. Written once per passing wave.
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
export function verifyMainAncestry({ memberIds, gitRun, boardStatus }) {
  const results = [];
  for (const id of memberIds) {
    const merged = (() => {
      try {
        gitRun(['merge-base', '--is-ancestor', `blocked/${id.toLowerCase()}`, 'main']);
        return true;
      } catch {
        try {
          gitRun(['merge-base', '--is-ancestor', `sw/${id.toLowerCase()}`, 'main']);
          return true;
        } catch {
          return false;
        }
      }
    })();
    results.push({
      id,
      onMain: merged,
      mayTransition: merged && boardStatus?.(id) !== 'done',
    });
  }
  return results;
}
