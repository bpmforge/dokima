// conductor/wave.mjs — the Level-2 synthetic wave branch (P3-01, OPT-09/OPT-12).
//
// A wave is a BOUNDED MERGE GATE: fresh main plus the candidate commits of a
// few compatible tickets, so the expensive assurance runs ONCE over the
// aggregate diff and cross-ticket seams become checkable — the class a
// per-ticket branch physically cannot expose. No feature work is ever
// authored on the synthetic branch; it is built, gated, and discarded.
//
// Policy backing: attest P-A2 legalized wave-level review in DoD language
// before this executor existed (the hard policy-before-executor ordering).

import { createHash } from 'node:crypto';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { globToRegex, nonWildPrefix } from '../conductor-lib.mjs';

/** Two write_scopes overlap when either side's non-wild prefix contains the other's. */
export function scopesOverlap(scopeA, scopeB) {
  const prefixes = (scope) => (scope ?? []).map((g) => nonWildPrefix(g) || g);
  for (const a of prefixes(scopeA)) {
    for (const b of prefixes(scopeB)) {
      if (
        a === b ||
        a.startsWith(`${b.replace(/\/$/, '')}/`) ||
        b.startsWith(`${a.replace(/\/$/, '')}/`)
      ) {
        return true;
      }
    }
  }
  // Glob-level check catches `x/**` vs a concrete `x/file.ts` the prefix walk missed.
  const res = (scopeA ?? []).map(globToRegex);
  return (scopeB ?? []).some((g) => res.some((r) => r.test(g.replace(/\*\*?/g, 'zz'))));
}

/**
 * Compose a wave from candidate tickets (parked branches with commits).
 * Deterministic and greedy in dependency-safe id order; every exclusion is
 * returned WITH ITS REASON — silently dropping a candidate would be the
 * dropped-finding class all over again.
 *
 * candidate: {id, branch, write_scope, points, changedLines, dependsOn, headSha}
 * cfg: {maxTickets, maxChangedLines, highRiskGlobs, highRiskMax}
 */
export function composeWave(candidates, cfg = {}, doneIds = new Set()) {
  const maxTickets = cfg.maxTickets ?? 8;
  const maxChangedLines = cfg.maxChangedLines ?? 1000;
  const highRiskMax = cfg.highRiskMax ?? 3;
  const riskRes = (cfg.highRiskGlobs ?? []).map((g) => new RegExp(g));

  const members = [];
  const excluded = [];
  let lines = 0;
  let riskCount = 0;
  const memberIds = new Set();

  for (const c of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
    const isRisk = (c.write_scope ?? []).some((p) => riskRes.some((r) => r.test(p)));
    const unmetDeps = (c.dependsOn ?? []).filter(
      (d) => !doneIds.has(d) && !memberIds.has(d),
    );
    if (unmetDeps.length) {
      excluded.push({ id: c.id, reason: `unmet dependencies: ${unmetDeps.join(', ')}` });
      continue;
    }
    const collision = members.find((m) => scopesOverlap(m.write_scope, c.write_scope));
    if (collision) {
      excluded.push({
        id: c.id,
        reason: `write_scope overlaps wave member ${collision.id} — disjoint scopes only`,
      });
      continue;
    }
    if (members.length >= maxTickets) {
      excluded.push({ id: c.id, reason: `wave full (${maxTickets} tickets)` });
      continue;
    }
    if (isRisk && riskCount >= highRiskMax) {
      excluded.push({
        id: c.id,
        reason: `high-risk budget full (${highRiskMax}) — risk work rides small waves`,
      });
      continue;
    }
    const cl = Number(c.changedLines ?? 0);
    if (lines + cl > maxChangedLines && members.length > 0) {
      excluded.push({
        id: c.id,
        reason: `changed-line budget: ${lines}+${cl} > ${maxChangedLines}`,
      });
      continue;
    }
    members.push(c);
    memberIds.add(c.id);
    lines += cl;
    if (isRisk) riskCount++;
  }
  return { members, excluded, changedLines: lines, highRisk: riskCount };
}

/**
 * Build the synthetic branch: detached worktree at base, merge each member's
 * branch in composition order. A member whose merge CONFLICTS is excluded
 * (with the conflict reset away) rather than hand-resolved — resolving a
 * conflict IS feature authorship, and no feature work happens here. A member
 * whose merge leaves the tree dirty for any other reason aborts the build:
 * a dirty synthetic tree means the substrate is lying about what it tests.
 *
 * gitRun is injected: (args[], opts?) => string, throws on nonzero.
 */
export function buildSyntheticBranch({
  members,
  base = 'main',
  worktreeDir,
  name,
  gitRun,
  metadataPaths = [],
}) {
  const stamp = createHash('sha256')
    .update(members.map((m) => `${m.id}@${m.headSha}`).join('|'))
    .digest('hex')
    .slice(0, 8);
  const branch = name ?? `wave/synth-${stamp}`;
  const wt = resolve(worktreeDir, `wave-${stamp}`);
  try {
    gitRun(['worktree', 'remove', '--force', wt]);
  } catch {
    /* none prior */
  }
  try {
    rmSync(wt, { recursive: true, force: true });
  } catch {
    /* none prior */
  }
  try {
    gitRun(['branch', '-D', branch]);
  } catch {
    /* none prior */
  }
  mkdirSync(worktreeDir, { recursive: true });
  gitRun(['worktree', 'add', '-q', '-b', branch, wt, base]);

  const merged = [];
  const conflicted = [];
  for (const m of members) {
    // P6-06: conflicts confined to metadataPaths (the board file) resolve
    // deterministically to the base's version; ANY other conflict still
    // excludes the member — feature work is never auto-resolved.
    const mres = mergeWithMetadataCarveOut({
      gitRun,
      cwd: wt,
      branch: m.branch,
      message: `wave: ${m.id}`,
      metadataPaths,
    });
    if (!mres.merged) {
      conflicted.push({
        id: m.id,
        reason: `merge conflict vs ${merged.length ? 'earlier wave members' : base} (${mres.conflictFiles.join(', ') || 'unknown files'}) — excluded, not hand-resolved (no feature work on the synthetic branch)`,
      });
      continue;
    }
    const dirty = gitRun(['status', '--porcelain'], { cwd: wt }).trim();
    if (dirty) {
      // REFUSE: something left uncommitted state on the synthetic tree.
      gitRun(['worktree', 'remove', '--force', wt]);
      throw new Error(
        `synthetic tree dirty after merging ${m.id}: ${dirty.split('\n')[0]} — refusing to gate a lying substrate`,
      );
    }
    merged.push({ id: m.id, headSha: m.headSha });
  }
  // P6-06: metadata files are reset to the BASE'S version by construction —
  // not only on conflict. A member whose stale board merges CLEAN would
  // otherwise carry it onto main and silently revert OTHER features' rows
  // (parked/done written at ROOT after the member forked). Board truth is
  // written at ROOT; the branch copies are bookkeeping history.
  if (metadataPaths.length && merged.length) {
    gitRun(['checkout', base, '--', ...metadataPaths], { cwd: wt });
    const metaDirty = gitRun(['status', '--porcelain'], { cwd: wt }).trim();
    if (metaDirty) {
      gitRun(['add', '--', ...metadataPaths], { cwd: wt });
      gitRun(
        [
          'commit',
          '-q',
          '-m',
          `wave: metadata reset to ${base} (ROOT board is the truth)`,
        ],
        { cwd: wt },
      );
    }
  }
  const headSha = gitRun(['rev-parse', 'HEAD'], { cwd: wt }).trim();
  return {
    branch,
    wt,
    headSha,
    merged,
    conflicted,
    baseSha: gitRun(['rev-parse', base]).trim(),
  };
}

/**
 * Invalidation (the OPT-09 rule): if ONE member's branch moved after the wave
 * passed, only that member and the synthetic result are invalid — every other
 * member's candidate remains a tested, intact asset.
 */
export function waveInvalidation(waveRecord, currentHeads) {
  const invalid = [];
  for (const m of waveRecord.merged ?? []) {
    const now = currentHeads.get?.(m.id) ?? currentHeads[m.id];
    if (now && now !== m.headSha) invalid.push({ id: m.id, was: m.headSha, now });
  }
  return {
    syntheticValid: invalid.length === 0,
    invalidMembers: invalid,
    intactMembers: (waveRecord.merged ?? [])
      .filter((m) => !invalid.some((i) => i.id === m.id))
      .map((m) => m.id),
  };
}

/**
 * P6-06: merge `branch` into the tree at `cwd`, with ONE deterministic
 * carve-out — a conflict confined entirely to `metadataPaths` (the board
 * file every ticket branch must edit) resolves to OURS: the base/ROOT
 * version wins, because board truth is written at ROOT by park/land and the
 * branch's copy is bookkeeping history, not work. Any conflict touching a
 * non-metadata file aborts and reports — feature work is NEVER auto-resolved.
 * Returns { merged: bool, conflictFiles: [] } — conflictFiles only on abort.
 */
export function mergeWithMetadataCarveOut({
  gitRun,
  cwd,
  branch,
  message,
  metadataPaths = [],
}) {
  try {
    gitRun(['merge', '--no-ff', '-q', '-m', message, branch], { cwd });
    return { merged: true, conflictFiles: [] };
  } catch {
    let conflictFiles = [];
    try {
      conflictFiles = gitRun(['diff', '--name-only', '--diff-filter=U'], { cwd })
        .split('\n')
        .filter(Boolean);
    } catch {
      /* diff unavailable — treat as non-metadata conflict below */
    }
    const meta = new Set(metadataPaths);
    if (conflictFiles.length && conflictFiles.every((f) => meta.has(f))) {
      gitRun(['checkout', '--ours', '--', ...conflictFiles], { cwd });
      gitRun(['add', '--', ...conflictFiles], { cwd });
      gitRun(['commit', '-q', '--no-edit'], { cwd });
      return { merged: true, conflictFiles: [] };
    }
    try {
      gitRun(['merge', '--abort'], { cwd });
    } catch {
      /* no in-progress merge */
    }
    return { merged: false, conflictFiles };
  }
}

/**
 * P6-06: intra-feature dependency stacking. Under per-feature landing a
 * dependency that is PARKED is done-on-its-branch but absent from main, so a
 * dependent claimed off main cannot build on it. This merges every parked
 * dependency's branch onto the fresh claim worktree BEFORE the agent runs,
 * and returns the post-stack HEAD as `scopeBase` — the base every scope and
 * review diff must use, or the dependency's files read as out-of-scope work.
 * A stack conflict refuses the CLAIM (human integrates); nothing is charged.
 */
export function stackParkedDeps({ ticket, plan, wt, branchPrefix, gitRun, boardPath }) {
  const stacked = [];
  const preStackSha = gitRun(['rev-parse', 'HEAD'], { cwd: wt }).trim();
  for (const depId of ticket.depends_on ?? []) {
    const row = plan.tickets.find((t) => t.id === depId);
    if (row?.status !== 'parked') continue;
    const depBranch = `${branchPrefix}${depId.toLowerCase()}`;
    const res = mergeWithMetadataCarveOut({
      gitRun,
      cwd: wt,
      branch: depBranch,
      message: `stack: parked dependency ${depId} (per-feature landing)`,
      metadataPaths: boardPath ? [boardPath] : [],
    });
    if (!res.merged) {
      return {
        stacked,
        scopeBase: null,
        failed: `stack conflict: parked dependency ${depId} (${depBranch}) does not merge onto the claim base (conflicts: ${res.conflictFiles.join(', ') || 'unknown'}) — human integrates; nothing charged to this ticket`,
      };
    }
    stacked.push(depId);
  }
  // Same rule as the synthetic build: the CLAIM BASE's board survives the
  // stack by construction — the dep's branch-board is history, ROOT's park
  // rows are the truth the agent must start from.
  if (boardPath && stacked.length) {
    gitRun(['checkout', preStackSha, '--', boardPath], { cwd: wt });
    if (gitRun(['status', '--porcelain'], { cwd: wt }).trim()) {
      gitRun(['add', '--', boardPath], { cwd: wt });
      gitRun(['commit', '-q', '-m', 'stack: board reset to claim base (ROOT truth)'], {
        cwd: wt,
      });
    }
  }
  const scopeBase = gitRun(['rev-parse', 'HEAD'], { cwd: wt }).trim();
  return { stacked, scopeBase, failed: null };
}
