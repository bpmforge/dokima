// conductor/product-loop.mjs — the PRODUCT goal loop (P5-01).
//
// The conductor drains a board; nothing above it asked "does the product the
// user stories describe actually exist and provably work?" This loop is that
// layer — the /goal skill's contract, executable:
//
//   INVENTORY  requirement ids RE-DERIVED from the SRS/USER_STORIES text
//              every iteration (the denominator is the spec, never the
//              ticket list — A-1's silent divergence is unrepresentable)
//   VERIFY     the assembly gate (requirement closure + assembly tickets +
//              seam assertions + long-tail) AND a green verify receipt
//   EXIT       assemblyGate.pass && verify green — THE PRODUCT IS DONE when
//              every story is proven by an existing test and every seam
//              resolves; a drained board proves nothing
//   GAP        uncovered story -> implementation proposal; coded-not-done ->
//              proof proposal; missing assembly/long-tail -> generated rows.
//              Proposals land on the board tagged proposed_by=product-loop
//              and pass through EVERY conductor gate incl. the risk tier.
//   BUDGET     iteration cap (goal-skill rule: a loop without a cap is
//              budget-to-burn) and a NO-PROGRESS HALT when the gap
//              fingerprint is byte-identical to last iteration (the
//              run-coverage-loop exit-3 rule) — iterating again is futile,
//              a human chooses waiver / re-scope / specialist.
//
// Vendor cross-check (2026 research, cited in the P5-01 ticket note): the
// three mechanisms present in ALL of Cursor, Anthropic, and OpenAI's
// full-cycle harnesses are exactly this module's skeleton —
//   (i)  a PRE-DECLARED VERIFICATION SURFACE as the exit condition, never
//        model self-belief (OpenAI Goals: outcome + verification surface;
//        Anthropic: feature list with passes flipped only on E2E evidence;
//        Cursor: CI + risk-tiered review as the merge exit);
//   (ii) a PERSISTENT GOAL/STATE ARTIFACT that survives sessions and
//        re-seeds each iteration (requirement-ledger.json here; their
//        Memories / progress-file+git / thread-scoped goals);
//   (iii) E2E VERIFICATION OF THE LIVE PRODUCT as the anti-"all tasks done
//        but it doesn't work" gate (verifyMain runs the full verify incl.
//        the e2e suite — the diff is not the product).
// Frozen constraint carried from the Anthropic harness: proposals may add
// tests; NOTHING in this loop may remove or weaken one — the spec-derived
// contract is immutable from inside the loop.

import { createHash } from 'node:crypto';

let assembler; // lazy TS import (heal.mjs pattern) | 'unavailable'
async function loadAssembler() {
  if (assembler) return assembler;
  // P6-09: under plain node, gate.ts's runtime .js specifiers need the
  // workspace tsx loader; under vitest this is a no-op. Best-effort — a
  // vendored install still degrades loudly below.
  const { ensureTsLoader } = await import('./ts-loader.mjs');
  await ensureTsLoader();
  try {
    const [ledger, gate, assembly, longtail] = await Promise.all([
      import('../../packages/pipeline/src/assembler/ledger.ts'),
      import('../../packages/pipeline/src/assembler/gate.ts'),
      import('../../packages/pipeline/src/assembler/assembly.ts'),
      import('../../packages/pipeline/src/assembler/longtail.ts'),
    ]);
    assembler = {
      deriveRequirementIds: ledger.deriveRequirementIds,
      assemblyGate: gate.assemblyGate,
      missingAssemblyTickets: assembly.missingAssemblyTickets,
      generateAssemblyTickets: assembly.generateAssemblyTickets,
      generateLongTailWave: longtail.generateLongTailWave,
      longTailGaps: longtail.longTailGaps,
    };
  } catch {
    assembler = 'unavailable';
  }
  return assembler;
}

/** Build the ledger from evidence: which tickets cite the id, which existing tests name it. */
export function buildLedger({ requirementIds, tickets, provingTestsFor }) {
  const ledger = {};
  for (const id of requirementIds) {
    const implementing = tickets
      .filter((t) => {
        const text = [t.title, ...(t.acceptance ?? []), String(t.implements ?? '')].join(
          ' ',
        );
        return text.includes(id);
      })
      .map((t) => t.id);
    ledger[id] = {
      implementingTickets: implementing,
      provingTests: provingTestsFor(id),
      status: 'uncovered', // recomputed by the gate; data, not authority
    };
  }
  return ledger;
}

/** Stable identity of an iteration's gap set — byte-identical = no progress. */
export function gapFingerprint(gaps) {
  return createHash('sha256')
    .update([...gaps].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** Turn gate gaps into board-row proposals. Deduplicated against existing ids. */
export function gapsToProposals({ gaps, seams, tickets, asm, longTailPrefix = 'LT' }) {
  const existing = new Set(tickets.map((t) => t.id));
  const proposals = [];
  const push = (row) => {
    if (!existing.has(row.id) && !proposals.some((p) => p.id === row.id)) {
      proposals.push({ ...row, proposed_by: 'product-loop' });
    }
  };
  for (const g of gaps) {
    const m = /requirement (\S+) is (uncovered|coded-not-done)/.exec(g);
    if (!m) continue;
    const [, reqId, status] = m;
    if (status === 'uncovered') {
      push({
        id: `PRD-${reqId}`,
        title: `Implement ${reqId} — the story exists in the SRS and nothing on the board builds it`,
        lane: 'product',
        write_scope: ['apps/**', 'packages/**'],
        depends_on: [],
        acceptance: [
          `${reqId}'s behavior exists and a test whose title names ${reqId} passes on main`,
        ],
        points: 3,
        status: 'todo',
      });
    } else {
      push({
        id: `PRF-${reqId}`,
        title: `Prove ${reqId} — implemented but no existing test names it (coded, not done)`,
        lane: 'product',
        write_scope: ['apps/**', 'packages/**', 'e2e/**'],
        depends_on: [],
        acceptance: [
          `a real, failing-capable test whose title names ${reqId} exists and passes on main`,
        ],
        points: 2,
        status: 'todo',
      });
    }
  }
  // Wiring nobody wrote by hand: assembly tickets from the seam graph.
  for (const row of asm.generateAssemblyTickets(
    asm.missingAssemblyTickets(seams, tickets),
  )) {
    push(row);
  }
  // The long tail is a PLANNED wave, not what is left over.
  if (asm.longTailGaps(tickets).length > 0) {
    for (const row of asm.generateLongTailWave(longTailPrefix)) push(row);
  }
  return proposals;
}

/**
 * The loop. Every port injected; the CLI wires reality.
 * ports: { readSources, readBoard, appendTickets, writeLedger,
 *          provingTestsFor, testExists, seams, seamResults,
 *          verifyMain, runConductor, log }
 */
export async function productLoop(ports, budget = {}) {
  // Injected in tests; the real lazy TS import in production. Same seam shape
  // as heal.mjs — a vendored install degrades loudly, never silently.
  const asm = ports.assembler ?? (await loadAssembler());
  if (asm === 'unavailable') {
    return {
      done: false,
      halt: 'assembler-unavailable',
      detail:
        'packages/pipeline is not present (vendored install) — the product loop cannot measure requirement closure, and an unmeasured product is not a done product',
    };
  }
  const maxIterations = budget.maxIterations ?? 5;
  const log = ports.log ?? (() => {});
  let prevFp = null;
  const history = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const srsText = ports.readSources();
    const requirementIds = asm.deriveRequirementIds(srsText);
    const tickets = ports.readBoard();
    const ledger = buildLedger({
      requirementIds,
      tickets,
      provingTestsFor: ports.provingTestsFor,
    });
    const seams = ports.seams();
    const gate = asm.assemblyGate({
      ledger,
      requirementIds,
      seams,
      tickets,
      seamResults: ports.seamResults(),
      testExists: ports.testExists,
    });
    const verify = ports.verifyMain();
    const gaps = [
      ...gate.gaps,
      ...(verify.green ? [] : [`verify RED on main: ${verify.detail ?? ''}`]),
    ];
    history.push({ iteration, requirements: requirementIds.length, gaps: gaps.length });
    // The goal artifact (Cherny doctrine): done-as-a-PREDICATE, stated with
    // its success condition, its non-goals, and the acceptance check — and it
    // lives in a FILE so it survives compaction and re-seeds every session.
    ports.writeLedger({
      goal: {
        success:
          'every SRS-derived requirement closed by an existing proving test; every seam resolves; verify green on main',
        non_goals:
          'this loop never removes or weakens a test, never merges past a red gate, never widens the SRS',
        acceptance: 'assemblyGate.pass && verifyMain.green — evidence, not assertion',
        sourcesSha: createHash('sha256').update(srsText).digest('hex').slice(0, 16),
      },
      requirementIds,
      ledger,
      gaps,
      history,
      iteration,
    });

    if (gate.pass && verify.green) {
      log('product.done', {
        msg: `PRODUCT PROVEN in ${iteration} iteration(s): ${requirementIds.length} requirement(s) closed, every seam resolves, verify green — this is done meaning done`,
      });
      return { done: true, iterations: iteration, requirementIds, history };
    }

    const fp = gapFingerprint(gaps);
    if (fp === prevFp) {
      log('product.halt', {
        msg: `no-progress halt (iteration ${iteration}): the gap set is byte-identical to the previous iteration — iterating again is futile. A human chooses: waiver / re-scope / specialist.`,
      });
      return {
        done: false,
        halt: 'no-progress',
        iterations: iteration,
        stuckGaps: gaps,
        history,
      };
    }
    prevFp = fp;

    const proposals = gapsToProposals({ gaps, seams, tickets, asm });
    if (proposals.length) {
      ports.appendTickets(proposals);
      log('product.proposed', {
        msg: `iteration ${iteration}: ${gaps.length} gap(s) -> ${proposals.length} proposal(s): ${proposals.map((p) => p.id).join(', ')}`,
      });
    }
    log('product.drive', {
      msg: `iteration ${iteration}: running the conductor against the gapped board`,
    });
    // AWAITED (P6-07): a berths drive refreshes its board snapshot after the
    // engine returns; the next iteration must measure the board the engine
    // just changed, not the one it started from. (await on a sync port's
    // undefined return is a no-op.)
    await ports.runConductor({ maxTickets: budget.ticketsPerIteration ?? 8 });
  }
  log('product.halt', {
    msg: `iteration cap (${maxIterations}) reached with gaps open — goal-skill escalation, not a silent 6th lap`,
  });
  return { done: false, halt: 'iteration-cap', iterations: maxIterations, history };
}

/**
 * Drive-port factory (P6-03): the loop is ENGINE-AGNOSTIC — it always calls
 * `runConductor({ maxTickets })`, and which engine answers is wired here,
 * once, at the CLI seam. Two engines, one call shape:
 *
 *   conductor — the bootstrap harness (scripts/conductor.mjs); maxTickets
 *               maps to its --max-tickets dial.
 *   berths    — the PRODUCT's own engine: `dokima run start` composing
 *               runBerths + GlobalBerthGovernor + landClaimedTicket
 *               (apps/server/src/cli/run-build-berths.ts). Its dials are
 *               berth count + budget; maxTickets is deliberately NOT
 *               repurposed as either — a cap silently meaning something
 *               else is the A-1 class. The governor and budget bound the
 *               iteration instead.
 *
 * spawn is injected: (cmd, args) => {status} in production, a recorder in
 * tests — which is how the test proves both engines receive the drive call
 * unchanged.
 */
export function makeDrivePort({
  engine = 'conductor',
  spawn,
  projectId,
  mode = 'feature',
  berths = 2,
  actorId = 'product-loop',
  dbPath,
  agentCommand,
} = {}) {
  if (engine === 'conductor') {
    return ({ maxTickets }) =>
      spawn('node', ['scripts/conductor.mjs', '--max-tickets', String(maxTickets)]);
  }
  if (engine === 'berths') {
    if (!projectId) {
      throw new Error(
        "engine 'berths' requires a project id — the product engine addresses boards by fleet id, not by cwd",
      );
    }
    return (call) => {
      void call; // same call shape arrives; the engine's own dials bound the work
      return spawn('node', [
        'apps/server/src/bootstrap/cli-entry.mjs',
        'run',
        'start',
        '--project',
        projectId,
        '--mode',
        mode,
        '--breakpoint',
        'never',
        '--berths',
        String(berths),
        '--actor',
        actorId,
        // P6-07: the board plane — the same DB the loop's add-ticket verb
        // writes proposals into — and the agent the berths spawn (a real
        // project configures this; tests pass a stub).
        ...(dbPath ? ['--db', dbPath] : []),
        ...(agentCommand ? ['--agent-command', agentCommand] : []),
      ]);
    };
  }
  throw new Error(`unknown engine '${engine}' — expected conductor|berths`);
}
