/**
 * dev-entry.ts — boot the API directly, for development and e2e only.
 *
 * Split out of `main.ts` (W13-33). It carries a run-on-import side effect,
 * which is exactly why it must be a file NOTHING imports: bundled into one
 * file with the packaged CLI, a run-if-main guard's `import.meta.url` becomes
 * the bundle's own path and fires on every invocation. That made
 * `dokima --help` bind a port and open a writable `state.db` in the user's
 * working directory instead of printing usage.
 *
 * No guard here on purpose. This file exists to be executed; running it IS the
 * request. `apps/server/build.mjs` bundles `bootstrap/main.ts`, so this never
 * reaches the shipped artifact.
 *
 * The only consumer is `apps/web/playwright.config.ts`.
 */
import path from 'node:path';
import { buildServer, DEFAULT_PORT } from './main.js';
import { listenLocalhost } from './index.js';

const port = Number(process.env.DOKIMA_PORT ?? DEFAULT_PORT);
const dbPath =
  process.env.DOKIMA_STATE_DB ?? path.join(process.cwd(), '.dokima', 'state.db');

const { app } = await buildServer({ port, dbPath });
await listenLocalhost(app, port);
app.log.info(`dokima server listening on http://127.0.0.1:${port}`);
