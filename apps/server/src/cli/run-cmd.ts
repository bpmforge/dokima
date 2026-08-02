/**
 * `dokima run` (FR-C7, API_DESIGN.md `POST /projects/{id}/runs` +
 * `/runs/{id}/pause` + `/runs/{id}/resume`): the CLI drives run creation,
 * pause, and receipt-based resume through the exact same
 * `@dokima/harbormaster` verbs a future HTTP route would call — there is
 * no CLI-only reimplementation to drift from the "real" API.
 *
 * Fully self-contained (own arg parsing, own DB open) rather than growing
 * `parse.ts`'s `CliCommand` union: `run.ts`'s dispatcher only routes
 * `command === 'run'` here with the untouched rest-args, keeping this
 * ticket's footprint in the shared dispatcher/parser to the couple of lines
 * that last-mile wiring requires (plan.json SEAM FIX note).
 *
 * `run start --mode onboard` (W8-09): once the bookkeeping `createRun` call
 * succeeds, an onboard/analysis run is actually started and advanced via
 * `runOnboardAnalysis` (`../api/pipeline/index.js`) — the SAME function the
 * `POST /projects/:id/pipeline/onboard-run` HTTP route calls, never a
 * CLI-only reimplementation. `io.cwd` doubles as both `runSession`'s repo
 * root and the Improvement Plans project path (matches how the HTTP route
 * always derives the plans-store db path from a project's registered path,
 * never a caller-supplied override) — a `--db` override only redirects the
 * bookkeeping run-record log above, not the onboard analysis' own plans
 * writer, a pre-existing narrowing this ticket does not widen.
 */

import { parseArgs } from 'node:util';
import {
  createRun,
  getRun,
  InvalidRunTransitionError,
  markRunResumed,
  pauseRun,
  resumeProject,
  RunNotFoundError,
  stopRun,
  suspendRun,
  type BreakpointMode,
  type RunMode,
} from '@dokima/harbormaster';
import { runOnboardAnalysis } from '../api/pipeline/index.js';
import { openWritableLog, resolveDbPath } from './db.js';
import { ensureActorIdentity } from './identity.js';
import { CliUsageError } from './parse.js';

export interface RunCliIO {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
}

const RUN_MODES = ['new_product', 'onboard', 'feature', 'improve'] as const;
const BREAKPOINTS = ['ticket', 'wave', 'never'] as const;

function isRunMode(value: string): value is RunMode {
  return (RUN_MODES as readonly string[]).includes(value);
}

function isBreakpointMode(value: string): value is BreakpointMode {
  return (BREAKPOINTS as readonly string[]).includes(value);
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliUsageError(`--${name} must be a positive integer, got '${raw}'`);
  }
  return n;
}

interface StartCommand {
  readonly kind: 'start';
  readonly projectId: string;
  readonly mode: RunMode;
  readonly breakpoint: BreakpointMode;
  readonly berths: number;
  readonly phase: number | null;
  readonly budgetUsd: number | null;
  readonly budgetTokens: number | null;
  readonly actorId: string;
  readonly dbPath?: string;
}

interface RunTargetCommand {
  readonly kind: 'pause' | 'resume' | 'stop';
  readonly runId: string;
  readonly actorId: string;
  readonly dbPath?: string;
  /** `resume` only: the keychain-resolved minting secret `verifyReceipt` needs (FR-S2). */
  readonly signingKey?: string;
}

type RunCommand = StartCommand | RunTargetCommand;

const START_USAGE =
  'usage: dokima run start --project <id> --mode <new_product|onboard|feature|improve> ' +
  '--breakpoint <ticket|wave|never> --berths <n> --actor <id> ' +
  '[--phase <n>] [--budget-usd <n>] [--budget-tokens <n>] [--db <path>]';

function parseStart(rest: string[]): StartCommand {
  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      mode: { type: 'string' },
      breakpoint: { type: 'string' },
      berths: { type: 'string' },
      actor: { type: 'string' },
      phase: { type: 'string' },
      'budget-usd': { type: 'string' },
      'budget-tokens': { type: 'string' },
      db: { type: 'string' },
    },
    allowPositionals: false,
  });
  if (!values.project)
    throw new CliUsageError(`run start requires --project <id>\n${START_USAGE}`);
  if (!values.mode || !isRunMode(values.mode)) {
    throw new CliUsageError(
      `run start requires --mode one of ${RUN_MODES.join('|')}\n${START_USAGE}`,
    );
  }
  if (!values.breakpoint || !isBreakpointMode(values.breakpoint)) {
    throw new CliUsageError(
      `run start requires --breakpoint one of ${BREAKPOINTS.join('|')}\n${START_USAGE}`,
    );
  }
  if (!values.actor)
    throw new CliUsageError(`run start requires --actor <id>\n${START_USAGE}`);
  const berths = values.berths ? parsePositiveInt('berths', values.berths) : 1;
  const phase = values.phase !== undefined ? Number(values.phase) : null;
  if (phase !== null && !Number.isInteger(phase)) {
    throw new CliUsageError(`--phase must be an integer, got '${values.phase}'`);
  }
  const budgetUsd =
    values['budget-usd'] !== undefined ? Number(values['budget-usd']) : null;
  const budgetTokens =
    values['budget-tokens'] !== undefined ? Number(values['budget-tokens']) : null;
  return {
    kind: 'start',
    projectId: values.project,
    mode: values.mode,
    breakpoint: values.breakpoint,
    berths,
    phase,
    budgetUsd,
    budgetTokens,
    actorId: values.actor,
    dbPath: values.db,
  };
}

function parseRunTarget(
  kind: RunTargetCommand['kind'],
  rest: string[],
): RunTargetCommand {
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      actor: { type: 'string' },
      db: { type: 'string' },
      'signing-key': { type: 'string' },
    },
    allowPositionals: true,
  });
  const runId = positionals[0];
  if (!runId) {
    throw new CliUsageError(
      `usage: dokima run ${kind} <runId> --actor <id> [--db <path>]`,
    );
  }
  if (!values.actor) throw new CliUsageError(`run ${kind} requires --actor <id>`);
  const signingKey = values['signing-key'] ?? process.env.DOKIMA_SIGNING_KEY;
  if (kind === 'resume' && !signingKey) {
    throw new CliUsageError(
      'run resume requires --signing-key <key> or DOKIMA_SIGNING_KEY in the environment (FR-S2)',
    );
  }
  return { kind, runId, actorId: values.actor, dbPath: values.db, signingKey };
}

export function parseRunCommand(rest: string[]): RunCommand {
  const [sub, ...subRest] = rest;
  switch (sub) {
    case 'start':
      return parseStart(subRest);
    case 'pause':
    case 'resume':
    case 'stop':
      return parseRunTarget(sub, subRest);
    default:
      throw new CliUsageError(
        `usage: dokima run <start|pause|resume|stop> ...\n${START_USAGE}`,
      );
  }
}

/** Drives run creation/pause/resume/stop through `@dokima/harbormaster` — the same verbs a `POST /projects/{id}/runs`-shaped route would call (FR-C7). */
export async function executeRunCommand(rest: string[], io: RunCliIO): Promise<number> {
  let command: RunCommand;
  try {
    command = parseRunCommand(rest);
  } catch (err) {
    if (err instanceof CliUsageError) {
      io.stderr(err.message);
      return 2;
    }
    throw err;
  }

  const dbPath = resolveDbPath(io.cwd, command.dbPath);
  const log = openWritableLog(dbPath);
  try {
    ensureActorIdentity(log, command.actorId, io.now);

    if (command.kind === 'start') {
      const run = createRun(
        log,
        {
          id: `run-${(io.now ?? (() => new Date().toISOString()))()}`,
          projectId: command.projectId,
          mode: command.mode,
          phase: command.phase,
          breakpoint: command.breakpoint,
          berths: command.berths,
          budgetUsd: command.budgetUsd,
          budgetTokens: command.budgetTokens,
          actorId: command.actorId,
        },
        { now: io.now },
      );
      io.stdout(
        `${run.id} started -> ${run.status} (breakpoint=${run.breakpoint} berths=${run.berths})`,
      );

      if (command.mode === 'onboard') {
        const outcome = await runOnboardAnalysis({
          log,
          runId: run.id,
          projectPath: io.cwd,
          now: io.now,
        });
        io.stdout(
          `${run.id} onboard analysis complete: ` +
            `${Object.keys(outcome.result.stepArtifacts).length} steps, ` +
            `${outcome.proposed.length} findings proposed, ` +
            `${outcome.accepted.length} accepted onto the board`,
        );
      }
      return 0;
    }

    try {
      if (command.kind === 'pause') {
        const run = pauseRun(log, command.runId, command.actorId, { now: io.now });
        io.stdout(`${run.id} pause -> ${run.status}`);
        return 0;
      }
      if (command.kind === 'stop') {
        const run = stopRun(log, command.runId, command.actorId, { now: io.now });
        io.stdout(`${run.id} stop -> ${run.status}`);
        return 0;
      }
      // resume: FR-H3 — idempotent receipt-based resume, refuses on drift.
      const result = await resumeProject({
        log,
        repoRoot: io.cwd,
        signingKey: command.signingKey ?? '',
        now: io.now,
      });
      if (!result.ok) {
        suspendRun(log, command.runId, command.actorId, { now: io.now });
        io.stderr(`${command.runId} resume refused — state drift detected:`);
        for (const entry of result.driftReport) {
          io.stderr(`  ${entry.ticketId}: ${entry.reasons.join('; ')}`);
        }
        return 1;
      }
      const run = getRun(log, command.runId);
      if (run && (run.status === 'paused' || run.status === 'suspended')) {
        markRunResumed(log, command.runId, command.actorId, { now: io.now });
      }
      io.stdout(
        `${command.runId} resume -> ok (closed=${result.closed.length} skipped=${result.skipped.length})`,
      );
      return 0;
    } catch (err) {
      if (err instanceof RunNotFoundError || err instanceof InvalidRunTransitionError) {
        io.stderr(`refused: ${err.message}`);
        return 1;
      }
      throw err;
    }
  } finally {
    log.close();
  }
}
