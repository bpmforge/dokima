#!/usr/bin/env node
/**
 * smoke-pack.mjs — pack the tarball, install it into an empty directory, and
 * run the installed binary (`pnpm smoke:pack`).
 *
 * WHY THIS EXISTS. v1.0.0 was tagged with a `files` list that shipped
 * `bootstrap/cli-entry.mjs` and neither of the two modules it imports. Every
 * gate was green: lint, typecheck and the suite all run from the source tree,
 * where every file exists. The only thing that sees what a user actually gets
 * is installing the tarball — which the release handoff did by hand, once,
 * months before the import was added (`npx dokima --help` →
 * ERR_MODULE_NOT_FOUND on a clean install).
 *
 * TWO CHECKS, because one of them cannot see half the defect:
 *
 *  - `bootstrapImportsNotShipped` (offline, in `pnpm test`): walks every
 *    relative import of the `bin` entry — static AND `import('./x.mjs')` —
 *    transitively, and fails for any that `files` does not cover. This is the
 *    regression guard. The smoke alone could never have caught the missing
 *    `bundle-age.mjs`: cli-entry wraps that dynamic import in a catch that
 *    swallows the error, so a tarball without it boots and goes green.
 *  - `main()` (network: `npm install`, so NOT in `pnpm test` or pre-push):
 *    build → `npm pack` → install into a fresh temp dir → `--help`, `doctor`,
 *    and an explicit better-sqlite3 load. `doctor` on a fresh DOKIMA_HOME
 *    never opens a database, so without the probe a missing native binary
 *    would pass. It also fails when the tarball lacks the bundled SAST
 *    baseline (`sastBaselineNotShipped`, W23-60).
 *
 * THE INSTALL BEHAVES LIKE A DEFAULT npm CLIENT. `--ignore-scripts=false` is
 * explicit: a machine with `ignore-scripts=true` in its user npm config (the
 * posture this repo's own .npmrc takes, SC-16) gets no native binary, and the
 * smoke would then report a failure no default user sees. That posture IS a
 * real user condition — the release handoff documents it, it is not hidden.
 *
 * `npx --no -- dokima`, never bare `npx dokima`: if the local bin were missing,
 * bare npx may fetch an unrelated `dokima` from the registry and pass on it;
 * and without the `--`, npx takes `--help` as its OWN flag, prints npx's usage
 * and exits 0 — a `--help` check that passes on a CLI that cannot start.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Relative specifiers from `import ... from './x'` and `import('./x')`. */
const RELATIVE_IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

/**
 * Every relative module the `bin` entry loads, transitively, as repo-relative
 * POSIX paths (the entry included).
 *
 * @param {string} entry repo-relative path of the `bin` target
 * @param {string} [root]
 * @returns {string[]}
 */
export function runtimeImportClosure(entry, root = ROOT) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = readFileSync(path.join(root, rel), 'utf8');
    for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(rel), match[2]),
      );
      // Only source modules the entry itself resolves; the bundle
      // (dist/main.js) is built and listed separately.
      if (/\.(mjs|js)$/.test(target) && !target.includes('/dist/')) queue.push(target);
    }
  }
  return [...seen];
}

/** npm `files` semantics for the plain (non-glob) entries this repo uses. */
function coveredByFiles(rel, files) {
  return files.some((entry) => {
    const e = entry.replace(/\/+$/, '');
    return rel === e || rel.startsWith(`${e}/`);
  });
}

/**
 * The runtime imports of the `bin` entry that the published tarball would
 * NOT contain. Empty means every module the CLI loads ships.
 *
 * @param {{ bin?: Record<string, string>, files?: string[] }} pkg
 * @param {string} [root]
 * @returns {string[]}
 */
export function bootstrapImportsNotShipped(pkg, root = ROOT) {
  const files = pkg.files ?? [];
  const missing = [];
  for (const entry of Object.values(pkg.bin ?? {})) {
    for (const rel of runtimeImportClosure(entry, root)) {
      if (!coveredByFiles(rel, files)) missing.push(rel);
    }
  }
  return [...new Set(missing)];
}

/** W23-60: the bundled SAST baseline, which tool-sast falls back to. */
export const SAST_BASELINE_DIR = 'rules/sast-baseline';

/**
 * What the tarball must carry for the bundled SAST baseline to work: its
 * LICENSE (the rules are Apache-2.0 inside an FSL package, so shipping them
 * without it would misstate their terms) and at least one rule file. Returns
 * what is missing, given the tarball's file list (`npm pack --json`). Empty
 * means the baseline ships. Without it, every install reports tool-sast NOT
 * RUN again, and no gate that runs from the source tree would notice.
 *
 * @param {string[]} shipped paths inside the tarball
 * @returns {string[]}
 */
export function sastBaselineNotShipped(shipped) {
  const missing = [];
  if (!shipped.includes(`${SAST_BASELINE_DIR}/LICENSE`)) {
    missing.push(`${SAST_BASELINE_DIR}/LICENSE`);
  }
  if (!shipped.some((f) => f.startsWith(`${SAST_BASELINE_DIR}/`) && /\.ya?ml$/.test(f))) {
    missing.push(`${SAST_BASELINE_DIR}/*.yaml`);
  }
  return missing;
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    ...opts,
  });
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  console.log(`smoke:pack — ${pkg.name}@${pkg.version} on Node ${process.versions.node}`);

  const missing = bootstrapImportsNotShipped(pkg);
  if (missing.length > 0) {
    // Report, then still install: the end-to-end failure is the evidence.
    console.error(`smoke:pack: \`files\` does not ship: ${missing.join(', ')}`);
  }

  if (!process.argv.includes('--skip-build')) {
    run('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
  }

  // `dokima-` prefix: validate-temp-leaks watches it, so a leak from this
  // script is reported rather than accumulating unseen.
  const work = mkdtempSync(path.join(tmpdir(), 'dokima-pack-smoke-'));
  let failed = missing.length > 0;
  try {
    const packed = JSON.parse(
      run('npm', ['pack', '--json', '--pack-destination', work], { cwd: ROOT }),
    )[0];
    const shipped = packed.files.map((f) => f.path);
    console.log(
      `packed ${packed.filename}: ${shipped.length} files, ${packed.size} bytes`,
    );
    const baselineMissing = sastBaselineNotShipped(shipped);
    if (baselineMissing.length > 0) {
      console.error(
        `smoke:pack: the SAST baseline is not in the tarball: ${baselineMissing.join(', ')}`,
      );
      failed = true;
    } else {
      const rules = shipped.filter(
        (f) => f.startsWith(`${SAST_BASELINE_DIR}/`) && /\.ya?ml$/.test(f),
      );
      console.log(`SAST baseline shipped: ${rules.length} rule file(s) + LICENSE`);
    }
    const tests = shipped.filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f));
    if (tests.length > 0) {
      console.error(`smoke:pack: test files in the tarball: ${tests.join(', ')}`);
      failed = true;
    }

    const project = path.join(work, 'project');
    const home = path.join(work, 'home');
    run('mkdir', ['-p', project, home]);
    writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'dokima-pack-smoke', private: true }),
    );
    run(
      'npm',
      [
        'install',
        '--ignore-scripts=false',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        path.join(work, packed.filename),
      ],
      { cwd: project, stdio: 'inherit' },
    );

    const env = { ...process.env, DOKIMA_HOME: home };
    const help = run('npx', ['--no', '--', 'dokima', '--help'], { cwd: project, env });
    if (!help.includes('usage:')) {
      console.error('smoke:pack: `dokima --help` printed no usage');
      failed = true;
    }
    run('npx', ['--no', '--', 'dokima', 'doctor'], {
      cwd: project,
      env,
      stdio: 'inherit',
    });

    // doctor on a fresh home never opens state.db, so load the native module
    // explicitly — from the INSTALLED package's resolution, under this Node.
    const probe =
      "const { createRequire } = require('node:module');" +
      "const r = createRequire(require.resolve('@bpmforge/dokima/package.json'));" +
      "const Database = r('better-sqlite3');" +
      "const db = new Database(':memory:');" +
      "console.log('better-sqlite3 ' + db.prepare('select sqlite_version() v').get().v + ' loaded on Node ' + process.versions.node);" +
      'db.close();';
    run('node', ['-e', probe], { cwd: project, stdio: 'inherit' });
  } catch (err) {
    console.error(`smoke:pack: ${err.message.split('\n')[0]}`);
    failed = true;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (failed) {
    console.error('smoke:pack: FAILED');
    process.exit(1);
  }
  console.log('smoke:pack: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
