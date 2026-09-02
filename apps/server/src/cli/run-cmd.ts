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

import path from 'node:path';
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
import { executeBuildRun } from './run-build.js';
import type { RunCliIO } from './run-types.js';
import {
  openWritableLog,
  resolveDbPath,
  resolveDbPathForProject,
  UnknownProjectError,
} from './db.js';
import { ensureActorIdentity } from './identity.js';
import { CliUsageError } from './parse.js';

export type { RunCliIO } from './run-types.js';

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
  /**
   * W10-77: the agent CLI a ticket session runs (`createChildProcessSpawn`).
   * Absent means the build modes REFUSE rather than pretend — see
   * `executeBuildRun`. Never defaulted: picking an agent spends the founder's
   * own quota on unattended runs, which is their decision to make.
   */
  readonly agentCommand?: string;
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
  '[--phase <n>] [--budget-usd <n>] [--budget-tokens <n>] [--db <path>] ' +
  '[--agent-command <cli>]';

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
      'agent-command': { type: 'string' },
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
    agentCommand: values['agent-command'],
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

  /**
   * ADDRESS THE PROJECT, NOT THE SHELL (W22-23).
   *
   * This used to be `resolveDbPath(io.cwd, command.dbPath)`, so `--project
   * <id>` was written onto the run record as a label and never used to find
   * anything. Every other CLI verb resolves it through the fleet registry, and
   * `--help` promises it: "address a project with --project <id> from the
   * Fleet, or --db <path>".
   *
   * The consequence was not only a misplaced log. This module's own header
   * notes that "`io.cwd` doubles as both `runSession`'s repo", and run-build
   * derives the vault, the collected secrets, the effective settings, the
   * worktree root and the model matrix from it — so a run started outside the
   * project directory worked whatever repository the shell was standing in.
   * A configured project was told "no model is configured for this project
   * yet", naming the settings surface that had just been used successfully.
   *
   * `--db` still wins, unchanged: it is the explicit escape hatch, and a
   * caller who names a file means that file.
   */
  /**
   * AN UNREGISTERED ID IS NOT FATAL, and that is forced by the parser: `run
   * start` REQUIRES `--project <id>`, so a CLI-only user standing in their own
   * repository must pass one even when nothing has ever registered it. Making
   * it fatal would break the flow the flag is mandatory for.
   *
   * It is not silent either. Falling back to the current directory without
   * saying so is how the original defect read from the outside — a run that
   * quietly worked somewhere else.
   */
  let dbPath: string;
  if (command.kind === 'start') {
    try {
      dbPath = await resolveDbPathForProject(io.cwd, {
        ...(command.dbPath ? { db: command.dbPath } : {}),
        projectId: command.projectId,
        ...(io.env ? { env: io.env } : {}),
      });
    } catch (err) {
      if (!(err instanceof UnknownProjectError)) throw err;
      dbPath = resolveDbPath(io.cwd, command.dbPath);
      io.stderr(
        `no project registered with id ${command.projectId} — running against ` +
          `the current directory (${io.cwd}) instead`,
      );
    }
  } else {
    // pause/resume/stop carry no --project; they address the log the way they
    // always have, and `--db` remains their explicit escape hatch.
    dbPath = resolveDbPath(io.cwd, command.dbPath);
  }
  /**
   * Everything downstream reads the repo from `cwd`, so it has to BE the
   * project. Derived from the resolved database path rather than looked up a
   * second time: two resolutions of the same id are two chances to disagree.
   */
  // P6-17: dirname(dirname(db)) is only right for the canonical
  // <project>/.dokima/state.db layout. A flat `--db <project>/x.db` made the
  // root the project's PARENT — the run then indexed the shared tmpdir
  // (rg walked com.apple.* TemporaryItems) and refused. The db's directory
  // is the project unless that directory IS the .dokima folder.
  const dbDir = path.dirname(dbPath);
  const projectRoot = path.basename(dbDir) === '.dokima' ? path.dirname(dbDir) : dbDir;
  const projectIo: RunCliIO = { ...io, cwd: projectRoot };
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
          projectPath: projectRoot,
          now: io.now,
        });
        io.stdout(
          `${run.id} onboard analysis complete: ` +
            `${Object.keys(outcome.result.stepArtifacts).length} steps, ` +
            `${outcome.proposed.length} findings proposed, ` +
            `${outcome.accepted.length} accepted onto the board`,
        );
        return 0;
      }

      // AWAITED, not returned: this sits inside a `try { … } finally {
      // log.close() }`, and returning the pending promise lets the finally
      // close the connection out from under the loop — "The database
      // connection is not open", thrown from the loop's first getTicket.
      const buildCode = await executeBuildRun(log, command, run.id, projectIo);
      return buildCode;
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
