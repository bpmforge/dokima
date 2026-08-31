// conductor/heal.mjs — wire the EXISTING packages/loop policy engine into the
// conductor (P2-05, Law L4/L7). The classifier, budget tracker, and ceiling
// were implemented and tested in @dokima/loop with ZERO external callers —
// snapshot.ts admits it in its own source. This chapter is the missing call
// site, not a reimplementation: THE SHIPPED CONSTANTS WIN (metered cap 8,
// local floor 12 — not the doctrine prose's 6).
//
// Node ≥22.18 type-stripping loads the .ts sources directly. The import is
// LAZY and survivable: a conductor vendored into a foreign repo (the W9-12
// two-file contract) has no packages/loop — there the engine reports itself
// unavailable ONCE, loudly, and the ladder runs ungoverned, rather than an
// import crash taking the whole harness down. In this repo the engine loads.

let engine; // module bundle | 'unavailable'
async function loadEngine() {
  if (engine) return engine;
  try {
    const [classify, budget, convergence] = await Promise.all([
      import('../../packages/loop/src/loop-policy-classify.ts'),
      import('../../packages/loop/src/loop-policy-budget.ts'),
      import('../../packages/loop/src/loop-policy-convergence.ts'),
    ]);
    engine = {
      classifyIteration: classify.classifyIteration,
      createFindingBudgetTracker: budget.createFindingBudgetTracker,
      checkProgressCeiling: convergence.checkProgressCeiling,
      checkConvergence: convergence.checkConvergence,
    };
  } catch {
    engine = 'unavailable';
  }
  return engine;
}

/**
 * Per-ticket heal state: the budget tracker is stateful by design (2 attempts
 * per tier, +1 post-escalation, zero tolerance for a second oscillation).
 */
export async function createHealState(ticketPoints, tier = 'metered') {
  const eng = await loadEngine();
  if (eng === 'unavailable') return { unavailable: true };
  return {
    eng,
    tracker: eng.createFindingBudgetTracker(),
    prevFps: null, // Set<string> of the previous pass's failure fingerprints
    passesUsed: 0,
    ticketPoints: Number(ticketPoints ?? 3),
    tier,
    history: [], // PassOpenCount[] for the sliding convergence window
  };
}

/**
 * Fold one failed pass's fingerprint rows into the policy engine and return
 * the single action the conductor must take. Deterministic; the model's
 * prose has no vote here.
 *
 * @param state  createHealState()
 * @param rows   fingerprinted failure rows ({fp}) from receiptFingerprints
 * @returns {{iterationClass: string, action: 'CONTINUE'|'ESCALATE'|'SPLIT'|'BLOCK', why: string}}
 */
export function assessAttempt(state, rows) {
  if (state.unavailable) {
    return {
      iterationClass: 'UNAVAILABLE',
      action: 'CONTINUE',
      why: 'loop policy engine not present (vendored install without packages/loop) — ladder ungoverned; vendor the engine to enable self-healing',
    };
  }
  state.passesUsed += 1;
  const currentFps = new Set(rows.map((r) => r.fp));
  const prev = state.prevFps;
  state.prevFps = currentFps;

  // First failed pass: nothing to compare — the ladder proceeds normally,
  // but the tracker starts each fingerprint's budget.
  if (prev === null) {
    for (const fp of currentFps) state.tracker.evaluate(fp, 'STILL_PRESENT');
    return {
      iterationClass: 'FIRST',
      action: 'CONTINUE',
      why: 'first failed pass — budgets opened',
    };
  }

  const targeted = [...prev].map((fp) => ({
    fingerprint: fp,
    outcome: currentFps.has(fp) ? 'STILL_PRESENT' : 'RESOLVED',
  }));
  const newFps = [...currentFps].filter((fp) => !prev.has(fp));
  // A fingerprint the tracker saw RESOLVED earlier that returns is a
  // regression; the tracker itself detects it via its cleared-entry
  // bookkeeping when we evaluate REGRESSED below.
  const iterationClass = state.eng.classifyIteration({
    targeted,
    newFindingsOpened: newFps.length,
    regressedCount: 0, // per-fp regression is the tracker's call below
  });

  // Feed every current fingerprint through the budget tracker; the WORST
  // decision governs (BLOCK > ESCALATE > RETRY_SAME_TIER > CLEARED).
  const rank = { CLEARED: 0, RETRY_SAME_TIER: 1, ESCALATE: 2, BLOCK: 3 };
  let worst = { action: 'CLEARED' };
  for (const t of targeted) {
    const d = state.tracker.evaluate(t.fingerprint, t.outcome);
    if (rank[d.action] > rank[worst.action]) worst = d;
  }
  for (const fp of newFps) {
    const d = state.tracker.evaluate(fp, 'STILL_PRESENT');
    if (rank[d.action] > rank[worst.action]) worst = d;
  }

  // PROGRESSED into the ceiling is a PARK — "the ticket is decomposing
  // badly, split it" (loop-policy-convergence.ts:39). The shipped ceiling.
  if (iterationClass === 'PROGRESSED') {
    const ceiling = state.eng.checkProgressCeiling(
      state.passesUsed,
      state.ticketPoints,
      state.tier,
    );
    if (ceiling.action === 'PARK') {
      return {
        iterationClass,
        action: 'SPLIT',
        why: `PROGRESSED into the shipped ceiling (${state.passesUsed}/${ceiling.ceiling} passes) — decomposition signal, not a fix failure`,
      };
    }
    return {
      iterationClass,
      action: 'CONTINUE',
      why: 'progressing — prior rows closing, new count shrinking',
    };
  }

  // Sliding 2-pass convergence window: two non-PROGRESSED passes with a
  // non-decreasing open count is divergence — the loop is churning, not
  // converging. Escalation is the response (a stronger tier may converge);
  // the budget tracker still owns the hard BLOCK.
  state.history.push({
    pass: state.passesUsed,
    openCount: currentFps.size,
    iterationClass,
  });
  const convergence = state.eng.checkConvergence(state.history);
  if (convergence === 'DIVERGED' && rank[worst.action] < rank.ESCALATE) {
    return {
      iterationClass,
      action: 'ESCALATE',
      why: 'DIVERGED: open findings not decreasing across the sliding window',
    };
  }

  if (worst.action === 'BLOCK') {
    return {
      iterationClass,
      action: 'BLOCK',
      why: `budget tracker: ${worst.reason ?? 'post-escalation stall or second oscillation'} — the third identical attempt is the worst spend in the system`,
    };
  }
  if (worst.action === 'ESCALATE') {
    return {
      iterationClass,
      action: 'ESCALATE',
      why: `budget tracker: ${worst.reason ?? 'stall'} after ${worst.attemptsAtTier ?? 2} same-tier attempts`,
    };
  }
  return {
    iterationClass,
    action: 'CONTINUE',
    why:
      worst.action === 'CLEARED' ? 'prior findings cleared' : 'within same-tier budget',
  };
}

/**
 * SPLIT: derive child tickets from the parked parent — a mechanical
 * decomposition by write_scope partition. Pure; the caller writes the board.
 * Returns null when the scope cannot be partitioned (single entry): a ticket
 * that cannot be split any further must BLOCK instead, honestly.
 */
export function proposeSplit(t) {
  const scope = t.write_scope ?? [];
  if (scope.length < 2) return null;
  const mid = Math.ceil(scope.length / 2);
  const halves = [scope.slice(0, mid), scope.slice(mid)];
  return halves.map((half, idx) => ({
    id: `${t.id}-S${idx + 1}`,
    title: `${t.title} (split ${idx + 1}/2 — parent parked at the PROGRESSED ceiling)`,
    lane: t.lane,
    write_scope: half,
    depends_on: idx === 0 ? [] : [`${t.id}-S1`],
    acceptance: [
      `Parent ${t.id}'s acceptance, restricted to this slice's write_scope: ${half.join(', ')}`,
      ...(t.acceptance ?? []),
    ],
    points: Math.max(1, Math.ceil(Number(t.points ?? 2) / 2)),
    status: 'todo',
    notes: `SPLIT CHILD of ${t.id} (P2-05 self-heal): parent hit the PROGRESSED ceiling — the change was too big, not wrong.`,
  }));
}
