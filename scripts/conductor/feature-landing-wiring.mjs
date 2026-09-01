// conductor/feature-landing-wiring.mjs — production composition for P6-02.
// feature-landing.mjs is the pure policy; this chapter binds it to the real
// repo: parked sw/* branches, the board's features[], P3-01's wave builders,
// the P0-01 receipt wrapper as the Tier-D verify on the synthetic head, and
// the P3-02 seam bridge. Kept out of conductor.mjs for the 400-line cap and
// out of feature-landing.mjs so the policy stays injectable.

import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { CONFIG, ROOT, log, sh, git, loadPlan } from './context.mjs';
import { writePlan } from '../conductor-lib.mjs';
import { featuresReadyToLand, landFeature } from './feature-landing.mjs';
import { composeWave, buildSyntheticBranch, waveInvalidation } from './wave.mjs';
import { mintReceipt, receiptGaps } from './receipts.mjs';
import { writeWavePacket } from './wave-packet.mjs';

/** Parked candidates: sw/* branches whose ROOT board row is 'parked' (durable, written at park time). */
function parkedCandidates(plan) {
  const out = [];
  for (const t of plan.tickets) {
    if (t.status !== 'parked') continue;
    const branch = `${CONFIG.branchPrefix}${t.id.toLowerCase()}`;
    try {
      const headSha = git('rev-parse', '--verify', branch);
      out.push({ id: t.id, branch, headSha });
    } catch {
      /* no parked branch — landed long ago or never parked */
    }
  }
  return out;
}

/** Tier-D verify on the synthetic head: the SAME receipt wrapper every gate uses. */
function verifySynthetic(record) {
  try {
    if (CONFIG.install?.length) {
      sh(CONFIG.install[0], CONFIG.install[1], { cwd: record.wt, timeout: 10 * 60_000 });
    }
    const { receipt } = mintReceipt({
      ticketId: `FEATURE-${record.branch.split('/').pop()}`,
      wt: record.wt,
      headSha: record.headSha,
      commands: CONFIG.verifyCommands ?? [],
      receiptsDir: resolve(ROOT, 'docs/work/receipts'),
      timeoutMin: CONFIG.gateTimeoutMin ?? 30,
    });
    const gaps = receiptGaps(receipt, record.headSha);
    return { green: gaps.length === 0, detail: gaps[0]?.split('\n')[0] ?? '' };
  } catch (e) {
    return {
      green: false,
      detail: `verify infra failure: ${String(e.message).slice(0, 200)}`,
    };
  }
}

async function seamGapsFor(plan, wt) {
  const seams = plan.seams ?? [];
  if (!seams.length) return [];
  try {
    const { seamGapsForWave } = await import('./wave-seams.mjs');
    return await seamGapsForWave({ seams, wtPath: wt });
  } catch {
    return ['Tier-D seam bridge unavailable — an unchecked seam is not a passed seam'];
  }
}

/**
 * Attempt every ready feature landing. Returns the ids of tickets whose
 * feature LANDED (their branches are deleted; their work is on main).
 * A feature that refuses (drift, red verify, seam gap, partial) is logged
 * and left parked — nothing lands in pieces.
 */
export async function tryFeatureLandings() {
  const plan = loadPlan();
  const parked = parkedCandidates(plan);
  if (!parked.length) return [];
  const { ready, waiting } = featuresReadyToLand({
    parked,
    boardTickets: plan.tickets,
    features: plan.features ?? [],
  });
  for (const w of waiting) {
    log('feature.waiting', {
      msg: `${w.featureId}: ${w.parked.length ?? w.parked} parked, waiting on ${w.openTickets.join(', ')}`,
    });
  }
  const landedIds = [];
  for (const r of ready) {
    const result = await landFeature({
      featureId: r.featureId,
      members: r.members,
      boardTickets: plan.tickets,
      deps: {
        composeWave,
        buildSyntheticBranch,
        waveInvalidation,
        writeWavePacket,
        verifySynthetic,
        // Seam gaps computed against the SYNTHETIC head landFeature builds.
        seamGapsFor: (record) => seamGapsFor(plan, record.wt),
        waveCfg: CONFIG.wave ?? {},
        worktreeDir: resolve(ROOT, CONFIG.worktreeDir ?? '../.shipwright-worktrees'),
        packetDir: resolve(ROOT, `docs/work/attempt-evidence/${r.featureId}`),
        gitRun: (a, o) => sh('git', a, o).toString(),
        log,
      },
    });
    if (result.landed) {
      landedIds.push(...r.members.map((m) => m.id));
      // The truth the merge may not have carried: mark the members done at
      // ROOT. (The synthetic merge brings each branch's own done-row when it
      // merges clean; this write is the deterministic backstop and is what
      // un-parks the rows either way.)
      const rootPlan = loadPlan();
      let changed = false;
      for (const m of r.members) {
        const row = rootPlan.tickets.find((x) => x.id === m.id);
        if (row && row.status !== 'done') {
          row.status = 'done';
          changed = true;
        }
      }
      if (changed) {
        writePlan(ROOT, rootPlan, CONFIG.boardPath);
        sh('git', ['add', CONFIG.boardPath]);
        sh('git', [
          'commit',
          '-q',
          '-m',
          `chore(board): feature ${r.featureId} landed — ${r.members.map((m) => m.id).join(', ')} done`,
        ]);
      }
      // Cleanup: member branches + the synthetic worktree/branch.
      for (const m of r.members) {
        try {
          git('branch', '-d', m.branch);
        } catch {
          /* branch already gone */
        }
      }
      try {
        git('worktree', 'remove', '--force', result.record.wt);
      } catch {
        /* best effort */
      }
      try {
        rmSync(result.record.wt, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      try {
        git('branch', '-D', result.record.branch);
      } catch {
        /* best effort */
      }
    } else {
      log('feature.refused', { msg: result.reason });
      // Challenger finding 7: a refusal must not leak the synthetic worktree
      // and branch. Member branches stay — they are the parked assets.
      if (result.record) {
        try {
          git('worktree', 'remove', '--force', result.record.wt);
        } catch {
          /* best effort */
        }
        try {
          rmSync(result.record.wt, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
        try {
          git('branch', '-D', result.record.branch);
        } catch {
          /* best effort */
        }
      }
    }
  }
  return landedIds;
}

export { seamGapsFor }; // exported for the future async seam wiring + tests
