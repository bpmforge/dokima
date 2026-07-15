/**
 * apps/server entry point (W4-01 scaffold). `buildServer()` assembles the
 * real API server (auth, healthz, WS hub, SPA static bundle) around a
 * project event log; `main()` is the CLI boot path, guarded so importing
 * this module (tests) never binds a socket or touches the filesystem by
 * side effect.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openEventLog } from '@shipwright/events';
import {
  buildApiServer,
  ensureAuthToken,
  listenLocalhost,
  type ApiServer,
} from './api/index.js';

const DEFAULT_PORT = 4317;

export interface BuildServerOptions {
  port?: number;
  /** Project event log path (`.shipwright/state.db` beside the project, DATABASE.md). */
  dbPath: string;
  webDistDir?: string;
  token?: string;
  logger?: boolean;
}

export async function buildServer(opts: BuildServerOptions): Promise<ApiServer> {
  const port = opts.port ?? DEFAULT_PORT;
  const token = opts.token ?? (await ensureAuthToken()).token;
  const log = openEventLog(opts.dbPath);

  const server = await buildApiServer({
    token,
    port,
    isDbOpen: () => log.db.open,
    webDistDir: opts.webDistDir ?? defaultWebDistDir(),
    logger: opts.logger,
  });
  server.app.addHook('onClose', async () => {
    log.close();
  });
  return server;
}

function defaultWebDistDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '../../web/dist');
}

async function main(): Promise<void> {
  const port = Number(process.env.SHIPWRIGHT_PORT ?? DEFAULT_PORT);
  const dbPath =
    process.env.SHIPWRIGHT_STATE_DB ??
    path.join(process.cwd(), '.shipwright', 'state.db');
  const { app } = await buildServer({ port, dbPath });
  await listenLocalhost(app, port);
  app.log.info(`shipwright server listening on http://127.0.0.1:${port}`);
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
