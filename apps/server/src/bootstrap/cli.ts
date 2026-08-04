/**
 * The packaged CLI's command dispatch (DEPLOYMENT.md §1/§3/§6): default
 * (no args) boots the server + opens the Canvas, detecting an
 * already-running core first; `packs update` re-verifies + reinstalls the
 * first-party content pack. All the heavy dependencies are injectable so
 * this dispatch logic is testable without a real socket/browser/process.
 *
 * Argument handling is checked BEFORE any of that and never falls through to a
 * boot (W10-44): `--help`, `--version` and every mistyped command print and
 * exit, because booting a server is not a reasonable response to a typo.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildApiServer,
  ensureAuthToken,
  listenLocalhost,
  type ApiServer,
} from '../api/index.js';
import { openEventLog } from '@dokima/events';
import { computeDokimaHome, resolveAsset } from '@dokima/shared';
import { runBackupCommand, type BackupCommandDeps } from '../cli/ops/backup-cmd.js';
import { runDoctorCommand, type DoctorDeps } from '../cli/ops/doctor.js';
import {
  runProvidersRefreshCommand,
  type ProvidersRefreshDeps,
} from '../cli/ops/providers-refresh.js';
import { runServiceCommand, type ServiceDeps } from '../cli/ops/service.js';
import { runCli as runLifecycleCli } from '../cli/run.js';
import { runBootSequence, type BootReport } from './boot-sequence.js';
import { resolveLogLevel } from './config.js';
import { detectRunningCore, openBrowser } from './launch.js';
import { packsUpdate, type PacksUpdateResult } from './packs-update.js';

export const DEFAULT_PORT = 4317;

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  now?: () => string;
}

export interface CliDeps {
  runBootSequence?: typeof runBootSequence;
  detectRunningCore?: typeof detectRunningCore;
  openBrowser?: typeof openBrowser;
  packsUpdate?: typeof packsUpdate;
  buildApiServer?: typeof buildApiServer;
  listenLocalhost?: typeof listenLocalhost;
  ensureAuthToken?: typeof ensureAuthToken;
  backup?: BackupCommandDeps;
  doctor?: DoctorDeps;
  service?: ServiceDeps;
  providersRefresh?: ProvidersRefreshDeps;
}

export function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.DOKIMA_PORT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function webDistDir(): string {
  // Anchored to the distribution root, not to this file: under a bundle the
  // '..' hops landed outside the package entirely (W9-13).
  return resolveAsset('apps', 'web', 'dist');
}

async function runPacksUpdate(io: CliIO, deps: CliDeps): Promise<number> {
  const packsUpdateImpl = deps.packsUpdate ?? packsUpdate;
  const result: PacksUpdateResult = await packsUpdateImpl(
    path.join(computeDokimaHome(io.env), 'packs'),
  );
  if (!result.manifestValid) {
    io.stderr('packs update refused: manifest signature does not verify');
    return 1;
  }
  io.stdout(
    `packs update: ${result.verifiedFiles.length} file(s) verified + installed to ${result.installedTo}` +
      (result.rejectedFiles.length > 0
        ? `; ${result.rejectedFiles.length} rejected`
        : ''),
  );
  return result.rejectedFiles.length > 0 ? 1 : 0;
}

async function runServerBoot(io: CliIO, deps: CliDeps): Promise<number> {
  const runBootSequenceImpl = deps.runBootSequence ?? runBootSequence;
  const detectRunningCoreImpl = deps.detectRunningCore ?? detectRunningCore;
  const openBrowserImpl = deps.openBrowser ?? openBrowser;
  const buildApiServerImpl = deps.buildApiServer ?? buildApiServer;
  const listenLocalhostImpl = deps.listenLocalhost ?? listenLocalhost;
  const ensureAuthTokenImpl = deps.ensureAuthToken ?? ensureAuthToken;

  const port = resolvePort(io.env);
  const logLevel = resolveLogLevel(io.env);
  const url = `http://127.0.0.1:${port}`;

  // Check for an already-running core BEFORE touching the event log —
  // running the boot sequence here would open a second writable connection
  // to state.db (SQLITE_BUSY risk) and sweepOrphans() would falsely mark
  // any operation still legitimately in-flight in the live core as crashed.
  if (await detectRunningCoreImpl({ port })) {
    io.stdout(`dokima is already running at ${url} — opening the Canvas`);
    openBrowserImpl(url);
    return 0;
  }

  let boot: { report: BootReport };
  try {
    const opened = await runBootSequenceImpl({
      projectDir: io.cwd,
      env: io.env,
      now: io.now,
    });
    boot = opened;
    // Boot sequence's own connection is only needed to migrate/sweep/verify —
    // the real serving connection below opens fresh so `@dokima/server`'s
    // existing api/main.ts machinery (out of write_scope to change the
    // signature of) stays the single writer for the actual session.
    opened.log.close();
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (logLevel === 'debug') {
    io.stderr(
      `[dokima] boot: backup=${boot.report.backupPath ?? 'none'} orphaned=${boot.report.orphaned.length} tailValid=${boot.report.tailCheck.valid}`,
    );
  }

  const { token } = await ensureAuthTokenImpl(io.env);
  const log = openEventLog(boot.report.paths.dbPath);
  const server: ApiServer = await buildApiServerImpl({
    token,
    port,
    isDbOpen: () => log.db.open,
    webDistDir: webDistDir(),
    logger: logLevel === 'debug',
  });
  server.app.addHook('onClose', async () => {
    log.close();
  });
  await listenLocalhostImpl(server.app, port);
  io.stdout(`dokima: listening at ${url}`);
  openBrowserImpl(url);
  return 0;
}

const SERVICE_SUBCOMMANDS = ['install', 'status', 'stop'] as const;

const USAGE = `dokima — local-first agentic development platform

usage:
  dokima                        boot the core and open the Canvas (or attach to a running one)
  dokima doctor                 check the local install and report what is wrong
  dokima backup                 write a backup of the event log
  dokima packs update           re-verify and reinstall the first-party content pack
  dokima providers refresh      re-discover models from every configured provider
  dokima service <install|status|stop>
                                manage the background service

board & tickets (address a project with --project <id> from the Fleet, or --db <path>):
  dokima board                  print the ticket board
  dokima claim|start|release <ticketId> --actor <id>
                                move a ticket through its lifecycle
  dokima close <ticketId> --actor <id> --files <a,b> --commits <sha> --verify-cmd <cmd>
                                close with a manifest — refused without one
  dokima accept <ticketId> --actor <id>
                                accept someone ELSE's work (maker != verifier)
  dokima comment <ticketId> --actor <id> --body <text>
  dokima verify-chain           verify the event log's hash chain
  dokima run <start|pause|resume|stop> ...
                                run bookkeeping (FR-C7)

  -h, --help                    print this and exit
  -V, --version                 print the version and exit

environment:
  DOKIMA_PORT                   port to bind (default ${DEFAULT_PORT})
  DOKIMA_HOME                   state directory (default ~/.dokima)
  DOKIMA_LOG_LEVEL              'debug' for boot diagnostics
  DOKIMA_DIST_ROOT              override the distribution-root probe`;

/**
 * The version from the distribution's own manifest.
 *
 * Read at call time rather than baked in: the bundle is built once and the
 * manifest beside it is the only thing that knows what version was published.
 * Anchored via `resolveAsset` so it works from both a source checkout and an
 * installed package (W10-43).
 */
function readVersion(): string {
  try {
    const raw = fs.readFileSync(resolveAsset('package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version !== '') return version;
    }
    return 'unknown';
  } catch {
    // A missing or unreadable manifest is not worth crashing `--version` over.
    return 'unknown';
  }
}

/**
 * The board/ticket lifecycle (W10-74). These were fully implemented in
 * `cli/run.ts` and reachable from NOTHING: `build.mjs` bundles only
 * `bootstrap/main.ts`, no package.json declared a bin for `cli/index.ts`, and
 * this dispatch answered `unknown command` for every one of them. So an
 * installed user could create a board and never advance a ticket on it —
 * measured, and the reason FR-C7 was unmet in the shipped artifact.
 */
const LIFECYCLE_COMMANDS = [
  'board',
  'verify-chain',
  'claim',
  'start',
  'accept',
  'release',
  'close',
  'comment',
  'run',
] as const;

/** Every first token this CLI answers to. Anything else is a typo, not a boot. */
const KNOWN_COMMANDS = [
  'packs',
  'backup',
  'doctor',
  'service',
  'providers',
  ...LIFECYCLE_COMMANDS,
] as const;

export async function runPackagedCli(
  argv: string[],
  io: CliIO,
  deps: CliDeps = {},
): Promise<number> {
  // Argument handling comes first and never falls through. Until W10-44 the
  // final statement of this function was an unconditional `runServerBoot`, so
  // `--help` — and any mistyped command — booted the core and opened a browser
  // instead of printing usage. Harmless in a source checkout; it is the first
  // thing a stranger runs after `npx @bpmforge/dokima`.
  if (argv[0] === '--help' || argv[0] === '-h') {
    io.stdout(USAGE);
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    io.stdout(readVersion());
    return 0;
  }
  if (argv[0] !== undefined && !(KNOWN_COMMANDS as readonly string[]).includes(argv[0])) {
    // Exit non-zero, not 0: a script must be able to tell a real run from a
    // typo, and a silent success here is how the original defect hid.
    io.stderr(`dokima: unknown command '${argv[0]}'`);
    io.stderr(USAGE);
    return 2;
  }

  if ((LIFECYCLE_COMMANDS as readonly string[]).includes(argv[0] ?? '')) {
    return runLifecycleCli(argv, {
      cwd: io.cwd,
      stdout: io.stdout,
      stderr: io.stderr,
      now: io.now,
      env: io.env,
    });
  }

  if (argv[0] === 'packs') {
    if (argv[1] === 'update') return runPacksUpdate(io, deps);
    io.stderr('usage: dokima packs update');
    return 2;
  }
  if (argv[0] === 'backup') {
    return runBackupCommand(io, deps.backup);
  }
  if (argv[0] === 'doctor') {
    return runDoctorCommand(io, deps.doctor);
  }
  if (argv[0] === 'service') {
    const subcommand = argv[1];
    if ((SERVICE_SUBCOMMANDS as readonly string[]).includes(subcommand ?? '')) {
      return runServiceCommand(
        subcommand as (typeof SERVICE_SUBCOMMANDS)[number],
        io,
        deps.service,
      );
    }
    io.stderr(`usage: dokima service <${SERVICE_SUBCOMMANDS.join('|')}>`);
    return 2;
  }
  if (argv[0] === 'providers') {
    if (argv[1] === 'refresh')
      return runProvidersRefreshCommand(io, deps.providersRefresh);
    io.stderr('usage: dokima providers refresh');
    return 2;
  }
  // Only reachable with no arguments at all — the default, unchanged.
  return runServerBoot(io, deps);
}
