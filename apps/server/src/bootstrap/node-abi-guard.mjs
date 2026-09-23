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
 * which names neither Dokima, nor the supported Node lines, nor the fix. It
 * is the most likely first-run failure on a developer machine (a shell on a
 * Node other than the one the binary was built under) and it produces the
 * least actionable message the product can emit.
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
 * The majors `engines.node` names, in order. `22.x || 24.x` → `['22', '24']`.
 *
 * v1.0.1 made two lines supported. Stripping everything after the first
 * non-digit — what this did while engines was a single `22.x` — would have
 * silently kept refusing Node 24 while engines said otherwise.
 *
 * @param {string | undefined} engines
 * @returns {string[]}
 */
export function supportedMajors(engines) {
  if (!engines) return [];
  return engines
    .split('||')
    .map((alt) => alt.trim().replace(/[^0-9].*$/, ''))
    .filter(Boolean);
}

/** `22.x or 24.x` — the supported lines as a person reads them. */
function describeSupported(majors) {
  return majors.map((m) => `${m}.x`).join(' or ');
}

/** The line to suggest switching to: the newest one supported. */
function newestMajor(majors) {
  return String(Math.max(...majors.map(Number)));
}

function switchNodeLines(major) {
  return [
    `  Fix: switch this shell to Node ${major} and run the command again.`,
    `    fnm use ${major}   # or: nvm use ${major}`,
    `    node -v         # must print v${major}.x`,
    ``,
    `  Every terminal needs this — fnm's default is often a different Node, so a`,
    `  fresh tab can land back on an unsupported version.`,
  ];
}

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
 * @param {string | undefined} engines value of `engines.node`, e.g. `22.x || 24.x`
 * @param {string} [running] `process.versions.node`
 * @returns {string | null} a named refusal, or null when this Node is supported
 */
export function checkNodeSupported(engines, running = process.versions.node) {
  const majors = supportedMajors(engines);
  if (majors.length === 0) return null;
  const actual = running.split('.')[0];
  if (majors.includes(actual)) return null;
  const target = newestMajor(majors);
  return [
    `dokima: unsupported Node version.`,
    ``,
    `  Dokima supports Node ${describeSupported(majors)}; this shell is running Node ${running}.`,
    `  The native module it depends on (better-sqlite3) is built per Node ABI,`,
    `  and loading it on an unsupported Node fails with a NODE_MODULE_VERSION`,
    `  error that names neither this product nor the fix.`,
    ``,
    ...switchNodeLines(target),
  ].join('\n');
}

/** Node prints both ABI numbers in the message; take them from there rather than a table. */
const ABI_RE =
  /NODE_MODULE_VERSION (\d+)\.\s*This version of Node\.js requires\s*NODE_MODULE_VERSION (\d+)/s;

/**
 * A named refusal for a native ABI mismatch, or `null` when the error is
 * something else entirely — an unrelated failure must pass through untouched
 * rather than be dressed up as a Node-version problem.
 *
 * TWO DIFFERENT FIXES since v1.0.1. On an UNSUPPORTED Node the fix is to
 * switch Node. On a SUPPORTED one the binary was simply built under the other
 * supported line (installed on 22, now running 24): switching back would be
 * the wrong advice, and the fix is to rebuild the native module for this Node.
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
  const majors = supportedMajors(ctx.engines ?? '22.x || 24.x');
  const running = ctx.running ?? process.versions.node;
  const runningSupported = majors.includes(running.split('.')[0]);

  const fix = runningSupported
    ? [
        `  Node ${running} is supported; the binary was built under a different`,
        `  Node and needs rebuilding for this one. In the directory Dokima is`,
        `  installed in (for a global install, reinstall it instead):`,
        `    npm rebuild better-sqlite3`,
        `  In a source checkout:`,
        `    pnpm rebuild better-sqlite3`,
      ]
    : switchNodeLines(newestMajor(majors));

  return [
    `dokima: this Node cannot load the bundled native modules.`,
    ``,
    `  Dokima supports Node ${describeSupported(majors)}; you are running Node ${running}.`,
    builtFor && needs
      ? `  The better-sqlite3 binary was built for ABI ${builtFor}, and Node ${running} wants ABI ${needs}.`
      : `  The better-sqlite3 binary was built for a different Node ABI.`,
    ``,
    ...fix,
  ].join('\n');
}
