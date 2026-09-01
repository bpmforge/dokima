// conductor/feature-landing.mjs — feature-grouped landing (P6-02).
//
// The founder critique, measured before this ticket: 22 of the last 30
// first-parent commits on main were per-ticket merges — the SDLC was doing
// "a bunch of PRs." In `landing: 'per-feature'` mode a done ticket PARKS its
// branch instead of merging, and a FEATURE lands as ONE wave when every one
// of its tickets is parked-done: composeWave over the feature's branches →
// buildSyntheticBranch → Tier-D verify receipt + seam gate on the synthetic
// head → drift checks → ONE --no-ff merge of the synthetic branch on main →
// writeWavePacket. P3-01's semantics are REUSED, not reimplemented: a member
// that moved after the feature wave passed refuses the landing
// (waveInvalidation); a conflicting member fails the whole feature — a
// feature does not land in pieces, and no conflict is ever hand-resolved.
//
// A feature with any open ticket never partially lands — half a feature on
// main is exactly the "kinda-working surprise" the product loop exists to
// prevent.

import { wave } from '../conductor-lib.mjs';

/**
 * Which feature a ticket belongs to: the board's features[] when present
 * (P6-01's map — the product's declared shape), else the wave prefix as the
 * structural fallback (W12 tickets are at least a cohort, if not a feature).
 */
export function featureOf(ticket, features = []) {
  for (const f of features) {
    if ((f.tickets ?? []).includes(ticket.id)) return f.id;
  }
  return `W:${wave(ticket.id)}`;
}

/**
 * Landing readiness: group parked-done tickets by feature and report which
 * features are COMPLETE (every ticket of the feature is parked-done) vs
 * WAITING (some ticket still open). Only complete features may land.
 *
 * parked: [{id, branch, headSha, changedLines}] — parked-done candidates.
 * boardTickets: every board row (to know a feature's full membership).
 */
export function featuresReadyToLand({ parked, boardTickets, features = [] }) {
  const parkedById = new Map(parked.map((p) => [p.id, p]));
  const membership = new Map(); // featureId -> {all: ids, parked: candidates}
  for (const t of boardTickets) {
    const f = featureOf(t, features);
    if (!membership.has(f)) membership.set(f, { all: [], parked: [] });
    membership.get(f).all.push(t.id);
    const p = parkedById.get(t.id);
    if (p) membership.get(f).parked.push(p);
  }
  const ready = [];
  const waiting = [];
  for (const [featureId, m] of membership) {
    if (m.parked.length === 0) continue; // nothing of this feature in flight
    const open = m.all.filter(
      (id) => !m.parked.some((p) => p.id === id) && !isClosed(boardTickets, id),
    );
    if (open.length === 0) ready.push({ featureId, members: m.parked });
    else
      waiting.push({ featureId, parked: m.parked.map((p) => p.id), openTickets: open });
  }
  return { ready, waiting };
}

function isClosed(boardTickets, id) {
  // Challenger finding 5: 'blocked' must NOT count as closed — a feature with
  // a blocked member landing without that member's work is exactly the "half
  // a feature on main" this module forswears. A blocked member holds the
  // whole feature in WAITING until a human unblocks or re-scopes it.
  const row = boardTickets.find((t) => t.id === id);
  return row?.status === 'done';
}

/**
 * Land one complete feature as ONE wave. All heavy lifting is injected —
 * these are P3-01/P3-04's real functions in production, fakes in tests —
 * so this stays the composition, not a re-derivation.
 *
 * deps: { composeWave, buildSyntheticBranch, waveInvalidation, writeWavePacket,
 *         verifySynthetic (Tier-D receipt on the synthetic head -> {green, detail}),
 *         seamGapsFor (async: record -> Tier-D seam gap strings on the synthetic head),
 *         waveCfg, worktreeDir, gitRun, log }
 */
export async function landFeature({ featureId, members, boardTickets, deps }) {
  const log = deps.log ?? (() => {});
  const byId = new Map(boardTickets.map((t) => [t.id, t]));
  const candidates = members.map((m) => ({
    ...m,
    write_scope: byId.get(m.id)?.write_scope ?? [],
    dependsOn: byId.get(m.id)?.depends_on ?? [],
    points: byId.get(m.id)?.points ?? 2,
  }));
  const composed = deps.composeWave(
    candidates,
    deps.waveCfg,
    new Set(boardTickets.filter((t) => t.status === 'done').map((t) => t.id)),
  );
  if (composed.members.length !== members.length) {
    // A feature that cannot compose whole does not land in pieces.
    return {
      landed: false,
      reason: `feature ${featureId} did not compose whole: ${composed.excluded
        .map((e) => `${e.id} (${e.reason})`)
        .join('; ')}`,
    };
  }
  const record = deps.buildSyntheticBranch({
    members: composed.members,
    worktreeDir: deps.worktreeDir,
    name: `wave/feature-${featureId.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`,
    gitRun: deps.gitRun,
    // P6-06: conflicts confined to the board file resolve to the base's
    // version (ROOT's park/done writes are the truth); code conflicts refuse.
    metadataPaths: deps.metadataPaths ?? [],
  });
  if (record.conflicted.length) {
    return {
      landed: false,
      record,
      reason: `feature ${featureId}: member(s) conflicted on the synthetic branch — ${record.conflicted
        .map((c) => c.id)
        .join(', ')}; a feature does not land in pieces`,
    };
  }
  const verify = deps.verifySynthetic(record);
  if (!verify.green) {
    return {
      landed: false,
      record,
      reason: `feature ${featureId}: Tier-D verify RED on the synthetic head — ${verify.detail ?? ''}`,
    };
  }
  // Tier-D seam preamble (P3-04's rule, reused as a check not a train),
  // computed against the SYNTHETIC HEAD the feature actually tested — an
  // open seam gap refuses the landing whole.
  const seamGaps = deps.seamGapsFor ? await deps.seamGapsFor(record) : [];
  if (seamGaps.length) {
    return {
      landed: false,
      record,
      reason: `feature ${featureId}: Tier-D seam gate open — ${String(seamGaps[0]).split('\n')[0]}`,
    };
  }
  // ONE merge per feature: the synthetic branch itself lands, once. Before
  // it does, the OPT-09 drift checks (P3-01's waveInvalidation + the P3-04
  // main-advanced rule): every member head must still be the tested head,
  // and main must still be the base the synthetic was built on.
  const currentHeads = Object.fromEntries(
    composed.members.map((m) => [m.id, deps.gitRun(['rev-parse', m.branch]).trim()]),
  );
  const inv = deps.waveInvalidation(record, currentHeads);
  if (!inv.syntheticValid) {
    return {
      landed: false,
      record,
      reason: `feature ${featureId}: member(s) moved after the wave passed — ${inv.invalidMembers
        .map((i) => i.id)
        .join(', ')}; intact members remain tested assets`,
    };
  }
  const mainNow = deps.gitRun(['rev-parse', 'main']).trim();
  if (mainNow !== record.baseSha) {
    return {
      landed: false,
      record,
      reason: `feature ${featureId}: main advanced under the landing (${record.baseSha.slice(0, 8)} -> ${mainNow.slice(0, 8)}) — the tested head no longer describes main + this feature`,
    };
  }
  try {
    deps.gitRun([
      'merge',
      '--no-ff',
      '-q',
      '-m',
      `Merge feature ${featureId}: ${members.length} ticket(s) as one landing (${members
        .map((m) => m.id)
        .join(
          ', ',
        )})\n\nTier-D verified on synthetic ${record.headSha.slice(0, 12)}; seam gate clean; drift checks green.`,
      record.branch,
    ]);
  } catch (e) {
    // Challenger finding 7b: an unexpected merge failure (untracked-file
    // collision, board-file conflict — the P6-06 class) must not leave ROOT
    // mid-merge and crash the conductor. Abort, refuse whole, keep the assets.
    try {
      deps.gitRun(['merge', '--abort']);
    } catch {
      /* no in-progress merge to abort */
    }
    return {
      landed: false,
      record,
      reason: `feature ${featureId}: final merge failed and was aborted — ${String(e.message ?? e).slice(0, 200)}`,
    };
  }
  const packet = deps.writeWavePacket
    ? deps.writeWavePacket({
        record,
        tiers: deps.tiers ?? { actOn: [], consider: [], noted: [], dismissed: [] },
        logRows: [],
        outDir: deps.packetDir,
        gitRun: deps.gitRun,
      })
    : null;
  log('feature.landed', {
    msg: `feature ${featureId}: ${members.length} ticket(s) landed as ONE merge (synthetic ${record.headSha.slice(0, 8)}); packet: ${packet ?? 'n/a'}`,
  });
  return { landed: true, record, packet };
}
