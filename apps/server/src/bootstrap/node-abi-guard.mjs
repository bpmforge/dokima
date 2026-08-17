/**
 * bootstrap/node-abi-guard.mjs — turn a native ABI mismatch into a message a
 * person can act on (W12-24).
 *
 * THE FAILURE THIS REPLACES, hit live on the first command of a supervised
 * run: `better-sqlite3` refuses to load and Node prints
 *
 *   NODE_MODULE_VERSION 127. This version of Node.js requires
 *   NODE_MODULE_VERSION 137. Please try re-compiling or re-installing...
 *
 * which names neither Dokima, nor Node 22, nor the fix. CLAUDE.md law 3
 * documents this exact trap and `fnm`'s default is Node 24, so it is the most
 * likely first-run failure on a developer machine and it produces the least
 * actionable message the product can emit.
 *
 * `doctor` cannot help: it dies on the same native import before any check
 * runs. A version guard is the one thing that must not depend on the thing it
 * is checking, which is why this lives at the entry point and is pure.
 *
 * NO 127-VERSUS-137 TABLE. Mapping Node majors to ABI numbers would be a
 * second constant drifting from the first (W12-01 is on the board for exactly
 * that), and it would need editing on every Node release. Instead this reads
 * the ABI numbers out of the error Node already produced, and the supported
 * line out of `engines.node` — the value that is already authoritative and
 * already ships in the package.
 */

/**
 * The PROACTIVE check, and the one that actually works.
 *
 * A first attempt wrapped the bundle import in try/catch and translated the
 * error. Its unit tests passed and it did NOTHING in reality: better-sqlite3
 * is loaded lazily, deep inside a command (`openEventLogReader`), long after
 * the import resolves — so the raw trace still reached the user. Caught by
 * running the real CLI on Node 24 rather than by a test, which is the whole
 * argument for doing that before believing a fix.
 *
 * Comparing the running MAJOR against `engines.node` needs nothing native,
 * cannot be outrun by a lazy require, and refuses before a single byte of the
 * bundle loads.
 *
 * @param {string | undefined} engines value of `engines.node`, e.g. `22.x`
 * @param {string} [running] `process.versions.node`
 * @returns {string | null} a named refusal, or null when this Node is supported
 */
export function checkNodeSupported(engines, running = process.versions.node) {
  if (!engines) return null;
  const wanted = engines.replace(/[^0-9].*$/, '');
  const actual = running.split('.')[0];
  if (!wanted || wanted === actual) return null;
  return [
    `dokima: unsupported Node version.`,
    ``,
    `  Dokima supports Node ${engines}; this shell is running Node ${running}.`,
    `  The bundled native modules (better-sqlite3) are built for Node ${wanted},`,
    `  and loading them here fails with a NODE_MODULE_VERSION error that names`,
    `  neither this product nor the fix.`,
    ``,
    `  Fix: switch this shell to Node ${wanted} and run the command again.`,
    `    fnm use ${wanted}   # or: nvm use ${wanted}`,
    `    node -v         # must print v${wanted}.x`,
    ``,
    `  Every terminal needs this — fnm's default is often a newer Node, so a`,
    `  fresh tab lands back on the wrong version.`,
  ].join('\n');
}

/** Node prints both ABI numbers in the message; take them from there rather than a table. */
const ABI_RE = /NODE_MODULE_VERSION (\d+)\.\s*This version of Node\.js requires\s*NODE_MODULE_VERSION (\d+)/s;

/**
 * A named refusal for a native ABI mismatch, or `null` when the error is
 * something else entirely — an unrelated failure must pass through untouched
 * rather than be dressed up as a Node-version problem.
 *
 * @param {unknown} err the error thrown while loading the bundle
 * @param {{ engines?: string, running?: string }} [ctx]
 * @returns {string | null}
 */
export function describeAbiMismatch(err, ctx = {}) {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (!message.includes('NODE_MODULE_VERSION')) return null;

  const match = ABI_RE.exec(message);
  const builtFor = match?.[1];
  const needs = match?.[2];
  const supported = ctx.engines ?? '22.x';
  const running = ctx.running ?? process.versions.node;
  const major = supported.replace(/[^0-9].*$/, '') || '22';

  return [
    `dokima: this Node cannot load the bundled native modules.`,
    ``,
    `  Dokima supports Node ${supported}; you are running Node ${running}.`,
    builtFor && needs
      ? `  The better-sqlite3 binary was built for ABI ${builtFor}, and Node ${running} wants ABI ${needs}.`
      : `  The better-sqlite3 binary was built for a different Node ABI.`,
    ``,
    `  Fix: switch this shell to Node ${major} and run the command again.`,
    `    fnm use ${major}   # or: nvm use ${major}`,
    `    node -v         # must print v${major}.x`,
    ``,
    `  Every terminal needs this — fnm's default is often a newer Node, so a`,
    `  fresh tab lands back on the wrong version.`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}
