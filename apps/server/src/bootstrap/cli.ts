/**
 * The packaged CLI's command dispatch (DEPLOYMENT.md §1/§3/§6): default
 * (no args) boots the server + opens the Canvas, detecting an
 * already-running core first; `packs update` re-verifies + reinstalls the
 * first-party content pack. All the heavy dependencies are injectable so
 * this dispatch logic is testable without a real socket/browser/process.
 */

import path from 'node:path';
import {
  buildApiServer,
  ensureAuthToken,
  listenLocalhost,
  type ApiServer,
} from '../api/index.js';
import { openEventLog } from '@shipwright/events';
import { computeShipwrightHome } from '@shipwright/shared';
import { runBootSequence, type BootReport } from './boot-sequence.js';
import { resolveLogLevel } from './config.js';
import { detectRunningCore, openBrowser } from './launch.js';
import { packsUpdate, type PacksUpdateResult } from './packs-update.js';

const DEFAULT_PORT = 4317;

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
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.SHIPWRIGHT_PORT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function webDistDir(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, '..', '..', '..', 'web', 'dist');
}

async function runPacksUpdate(io: CliIO, deps: CliDeps): Promise<number> {
  const packsUpdateImpl = deps.packsUpdate ?? packsUpdate;
  const result: PacksUpdateResult = await packsUpdateImpl(
    path.join(computeShipwrightHome(io.env), 'packs'),
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
    io.stdout(`shipwright is already running at ${url} — opening the Canvas`);
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
    // the real serving connection below opens fresh so `@shipwright/server`'s
    // existing api/main.ts machinery (out of write_scope to change the
    // signature of) stays the single writer for the actual session.
    opened.log.close();
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (logLevel === 'debug') {
    io.stderr(
      `[shipwright] boot: backup=${boot.report.backupPath ?? 'none'} orphaned=${boot.report.orphaned.length} tailValid=${boot.report.tailCheck.valid}`,
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
  io.stdout(`shipwright: listening at ${url}`);
  openBrowserImpl(url);
  return 0;
}

export async function runPackagedCli(
  argv: string[],
  io: CliIO,
  deps: CliDeps = {},
): Promise<number> {
  if (argv[0] === 'packs' && argv[1] === 'update') {
    return runPacksUpdate(io, deps);
  }
  return runServerBoot(io, deps);
}
