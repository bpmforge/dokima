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

import { resolveAsset } from '@dokima/shared';
import { openEventLog } from '@dokima/events';
import {
  buildApiServer,
  ensureAuthToken,
  type ApiServer,
} from './index.js';

/**
 * W12-01: the ONE declaration. `bootstrap/cli.ts` used to declare its own
 * `4317` as well, so changing the port was a two-file edit and the copy nobody
 * edited kept working and stayed green — no test could see the disagreement.
 *
 * It lives HERE, in `api/`, because the dependency runs bootstrap -> api:
 * `cli.ts` imports from `../api/index.js` and `api/` imports nothing from
 * `bootstrap/`. Putting the shared constant in `bootstrap/` and importing it
 * from `api/` would have inverted that and created a cycle — which is the
 * question this ticket was held on, answered by the import graph rather than
 * by preference.
 */
export const DEFAULT_PORT = 4317;

export interface BuildServerOptions {
  port?: number;
  /** Project event log path (`.dokima/state.db` beside the project, DATABASE.md). */
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
    // (`run-cmd.ts`: `--signing-key` ?? DOKIMA_SIGNING_KEY). Unset means
    // the export/import routes stay unregistered — see
    // BuildApiServerOptions.signingKey.
    signingKey: process.env.DOKIMA_SIGNING_KEY,
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

/*
 * THE SELF-BOOT THAT USED TO LIVE HERE IS GONE (W13-33), and this note is the
 * guard against it coming back.
 *
 * It was the standard run-if-main block: `pathToFileURL(process.argv[1]).href
 * === import.meta.url`, then boot a server. Correct in source, where those two
 * are different files. Catastrophic once bundled: esbuild puts every module in
 * ONE file, so `import.meta.url` becomes `dist/main.js` — which IS
 * `process.argv[1]` — and the guard fired on EVERY invocation of the packaged
 * CLI. `dokima --help` printed usage and then bound a port and opened a
 * WRITABLE `./.dokima/state.db` in the user's working directory, forever.
 *
 * That silently defeated W10-44, whose whole subject was `--help` not booting
 * the core: it fixed the source, every test in this repo runs the source, and
 * the artifact a customer installs was never covered.
 *
 * A module that is IMPORTED must not also be an ENTRY POINT. The dev boot now
 * lives in `dev-entry.ts`, which nothing imports.
 */

