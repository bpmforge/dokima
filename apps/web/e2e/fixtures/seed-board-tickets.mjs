/**
 * Seeds a project's `.shipwright/state.db` with ticket events for
 * board.spec.ts (FR-C4/FR-T4). Run via the real `tsx` binary so the dynamic
 * `import()`s below — of each package's `src/index.ts` by absolute `file://`
 * URL — get TS transformed; `apps/web` isn't allowed a direct dependency on
 * `@shipwright/tickets`/`@shipwright/events` (its `package.json` sits
 * outside this ticket's write_scope), and even if it were, apps/web's own
 * node_modules has no path to those workspace packages (pnpm strict mode,
 * no phantom deps) — an absolute-path dynamic import sidesteps both.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

async function loadPkg(pkg) {
  return import(pathToFileURL(path.join(repoRoot, 'packages', pkg, 'src', 'index.ts')).href);
}

const { openEventLog, createIdentity, appendEvent } = await loadPkg('events');
const { createTicket, claimTicket, startTicket, closeTicket, acceptTicket } =
  await loadPkg('tickets');

const [, , dbPath, scenario] = process.argv;
if (!dbPath || !scenario) {
  console.error('usage: seed-board-tickets.mjs <dbPath> <scenario>');
  process.exit(1);
}

const log = openEventLog(dbPath);
try {
  createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
  createIdentity(log, { id: 'reviewer-1', name: 'Reviewer', kind: 'machine' });

  if (scenario === 'basic') {
    createTicket(log, 'agent-1', {
      id: 'E2E-1',
      type: 'task',
      title: 'Wire the board',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    createTicket(log, 'agent-1', {
      id: 'E2E-2',
      type: 'bug',
      title: 'Blocked on E2E-1',
      lane: 'ui',
      writeScope: ['b/**'],
      dependsOn: ['E2E-1'],
    });
    createTicket(log, 'agent-1', {
      id: 'E2E-3',
      type: 'story',
      title: 'Ship the strips',
      lane: 'gateway',
      writeScope: ['c/**'],
    });
    claimTicket(log, { ticketId: 'E2E-3', actorId: 'agent-1' });
    startTicket(log, { ticketId: 'E2E-3', actorId: 'agent-1' });
    closeTicket(log, {
      ticketId: 'E2E-3',
      actorId: 'agent-1',
      files: ['c/x.ts'],
      commits: ['abc1234'],
      verify: { command: 'pnpm test', exitCode: 0 },
    });
    acceptTicket(log, { ticketId: 'E2E-3', actorId: 'reviewer-1' });
  } else if (scenario === 'drag-claim') {
    createTicket(log, 'agent-1', {
      id: 'E2E-DRAG-1',
      type: 'task',
      title: 'Draggable ready ticket',
      lane: 'ui',
      writeScope: ['a/**'],
    });
  } else if (scenario === 'dag-switch') {
    // Two independent 'ready' tickets with different dependsOn (one
    // resolved dep, one none) so the drawer's DagEditPanel shows visibly
    // different chip lists per ticket — proves ticket-switch-while-open
    // resets DagEditPanel's local draft state instead of carrying over the
    // previously-viewed ticket's dependencies.
    createTicket(log, 'agent-1', {
      id: 'E2E-DAG-BASE',
      type: 'task',
      title: 'Base dependency',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    claimTicket(log, { ticketId: 'E2E-DAG-BASE', actorId: 'agent-1' });
    startTicket(log, { ticketId: 'E2E-DAG-BASE', actorId: 'agent-1' });
    closeTicket(log, {
      ticketId: 'E2E-DAG-BASE',
      actorId: 'agent-1',
      files: ['a/x.ts'],
      commits: ['abc1234'],
      verify: { command: 'pnpm test', exitCode: 0 },
    });
    acceptTicket(log, { ticketId: 'E2E-DAG-BASE', actorId: 'reviewer-1' });
    createTicket(log, 'agent-1', {
      id: 'E2E-DAG-1',
      type: 'task',
      title: 'Depends on base',
      lane: 'ui',
      writeScope: ['b/**'],
      dependsOn: ['E2E-DAG-BASE'],
    });
    createTicket(log, 'agent-1', {
      id: 'E2E-DAG-2',
      type: 'task',
      title: 'No dependencies',
      lane: 'ui',
      writeScope: ['c/**'],
    });
  } else if (scenario === 'drag-refuse-close') {
    // Seeded straight to in_progress/owned-by-operator (via direct verb calls,
    // modeling the board's own claim+start) rather than driving it there
    // through two browser drags first — Playwright's native HTML5 drag
    // simulation is unreliable for a second `dragTo()` within one test, and
    // the board.spec.ts test only needs to exercise the refusal-producing
    // drop itself.
    createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
    createTicket(log, 'agent-1', {
      id: 'E2E-REFUSE-1',
      type: 'task',
      title: 'Operator in-progress ticket',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    claimTicket(log, { ticketId: 'E2E-REFUSE-1', actorId: 'operator' });
    startTicket(log, { ticketId: 'E2E-REFUSE-1', actorId: 'operator' });
  } else if (scenario === 'trace') {
    // A ticket worked by a run, plus a second ticket no run has ever
    // touched, so trace.spec.ts exercises both the honest-empty and
    // populated states of the real /tickets/:id/runs + /runs/:id/trace
    // routes end to end (not mocked, unlike TraceView.test.tsx/
    // TelemetryPanel.test.tsx). `claimTicket`/`startTicket` don't accept a
    // runId (a run is a loop-engine concept the tickets package doesn't
    // know about), so every run-tagged event here is appended directly —
    // same as runs-routes.test.ts does server-side — covering three real
    // classify.ts buckets (pass/gate/escalation; loop.pass/
    // gateway.call_completed don't have a real producer yet, see
    // trace/classify.ts's header).
    createTicket(log, 'agent-1', {
      id: 'E2E-TRACE-1',
      type: 'task',
      title: 'Ticket with a session trace',
      lane: 'ui',
      writeScope: ['a/**'],
    });
    createTicket(log, 'agent-1', {
      id: 'E2E-TRACE-EMPTY',
      type: 'task',
      title: 'Ticket never worked by a run',
      lane: 'ui',
      writeScope: ['b/**'],
    });
    appendEvent(log, {
      eventType: 'loop.pass',
      actorId: 'agent-1',
      ticketId: 'E2E-TRACE-1',
      runId: 'run-e2e-1',
      payload: { pass: 1 },
    });
    appendEvent(log, {
      eventType: 'gate.receipt_minted',
      actorId: 'agent-1',
      ticketId: 'E2E-TRACE-1',
      runId: 'run-e2e-1',
      payload: { validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }] },
    });
    appendEvent(log, {
      eventType: 'escalation.rung_advanced',
      actorId: 'agent-1',
      ticketId: 'E2E-TRACE-1',
      runId: 'run-e2e-1',
      payload: { fromRung: 'R1', toRung: 'R2' },
    });
  } else {
    throw new Error(`unknown scenario "${scenario}"`);
  }
} finally {
  log.close();
}
