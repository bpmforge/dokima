/**
 * apps/server's real boot path (W4-01 scaffold). `buildServer()` assembles
 * the API server (auth, healthz, WS hub, SPA static bundle) around a
 * project event log; `main()` is the CLI entry, guarded so importing this
 * module (tests) never binds a socket or touches the filesystem by side
 * effect.
 *
 * This lives under `apps/server/src/api/**` — not `apps/server/src/index.ts`
 * — because that file (and `apps/server/package.json`) are outside this
 * ticket's write_scope; `apps/server/src/index.ts` stays the pre-existing
 * `/health` placeholder from W0-01 untouched. `apps/web/playwright.config.ts`
 * boots the real server via `tsx src/api/main.ts` instead of `src/index.ts`.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAsset } from '@shipwright/shared';
import { openEventLog } from '@shipwright/events';
import {
  buildApiServer,
  ensureAuthToken,
  listenLocalhost,
  type ApiServer,
} from './index.js';

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
    // Same env var and precedence the CLI already uses for `run resume`
    // (`run-cmd.ts`: `--signing-key` ?? SHIPWRIGHT_SIGNING_KEY). Unset means
    // the export/import routes stay unregistered — see
    // BuildApiServerOptions.signingKey.
    signingKey: process.env.SHIPWRIGHT_SIGNING_KEY,
  });
  server.app.addHook('onClose', async () => {
    log.close();
  });
  return server;
}

function defaultWebDistDir(): string {
  // Anchored to the distribution root: this is the SPA the packaged server
  // serves, and the old hop broke under bundling (W9-13).
  return resolveAsset('apps', 'web', 'dist');
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
