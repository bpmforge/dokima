/**
 * v1.0.1 — the tarball must ship every module its `bin` entry loads.
 *
 * v1.0.0's `files` shipped cli-entry.mjs without node-abi-guard.mjs (a static
 * import) or bundle-age.mjs (a dynamic one), and a clean `npx dokima --help`
 * died with ERR_MODULE_NOT_FOUND. The end-to-end proof is `pnpm smoke:pack`
 * (needs the network, so it runs in CI, not here); this is the offline guard.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrapImportsNotShipped,
  runtimeImportClosure,
  SAST_BASELINE_DIR,
  sastBaselineNotShipped,
} from './smoke-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('the published tarball ships every module the CLI loads (v1.0.1)', () => {
  it(
    'RED FIXTURE: every relative import of the bin entry, static or dynamic, is ' +
      'covered by `files`. v1.0.0 shipped the entry alone and the installed CLI ' +
      'could not start',
    () => {
      expect(bootstrapImportsNotShipped(pkg)).toEqual([]);
    },
  );

  it(
    'follows DYNAMIC imports too. The smoke cannot see a missing bundle-age.mjs: ' +
      'cli-entry swallows that import failure, so only a static walk catches it',
    () => {
      const closure = runtimeImportClosure(pkg.bin.dokima);
      expect(closure).toContain('apps/server/src/bootstrap/node-abi-guard.mjs');
      expect(closure).toContain('apps/server/src/bootstrap/bundle-age.mjs');
    },
  );

  it('never ships a test file by listing the bootstrap directory wholesale', () => {
    expect(pkg.files.some((f) => /\.test\./.test(f))).toBe(false);
    expect(pkg.files).not.toContain('apps/server/src/bootstrap');
  });
});

describe('bootstrapImportsNotShipped against a fixture package', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function fixture(files) {
    dir = mkdtempSync(path.join(tmpdir(), 'dokima-smoke-pack-test-'));
    mkdirSync(path.join(dir, 'bin'), { recursive: true });
    mkdirSync(path.join(dir, 'lib'), { recursive: true });
    writeFileSync(
      path.join(dir, 'bin/entry.mjs'),
      "import { a } from './a.mjs';\nconst b = await import('../lib/b.mjs');\n",
    );
    writeFileSync(
      path.join(dir, 'bin/a.mjs'),
      "import './c.mjs';\nexport const a = 1;\n",
    );
    writeFileSync(path.join(dir, 'bin/c.mjs'), 'export {};\n');
    writeFileSync(
      path.join(dir, 'lib/b.mjs'),
      "import fs from 'node:fs';\nexport default fs;\n",
    );
    return { bin: { x: 'bin/entry.mjs' }, files };
  }

  it('reports a transitive import the files list misses, and ignores bare specifiers', () => {
    const p = fixture(['bin/entry.mjs', 'bin/a.mjs', 'lib']);
    expect(bootstrapImportsNotShipped(p, dir)).toEqual(['bin/c.mjs']);
  });

  it('treats a directory entry as covering everything under it', () => {
    const p = fixture(['bin/', 'lib']);
    expect(bootstrapImportsNotShipped(p, dir)).toEqual([]);
  });
});

/**
 * W23-60 — the bundled SAST baseline is what a fresh install runs tool-sast
 * on. The pack smoke (CI) checks the real tarball's file list with the same
 * function; this is the offline half.
 */
describe('the tarball ships the bundled SAST baseline (W23-60)', () => {
  it('`files` lists the baseline directory, and not its fixtures', () => {
    expect(pkg.files).toContain(SAST_BASELINE_DIR);
    expect(pkg.files.some((f) => f.includes('sast-baseline-fixtures'))).toBe(false);
  });

  it('RED FIXTURE: a tarball without the LICENSE or without rule files is refused', () => {
    expect(sastBaselineNotShipped(['package.json'])).toEqual([
      'rules/sast-baseline/LICENSE',
      'rules/sast-baseline/*.yaml',
    ]);
    expect(sastBaselineNotShipped(['rules/sast-baseline/LICENSE'])).toEqual([
      'rules/sast-baseline/*.yaml',
    ]);
    expect(
      sastBaselineNotShipped([
        'rules/sast-baseline/LICENSE',
        'rules/sast-baseline/js-tls.yaml',
      ]),
    ).toEqual([]);
  });
});
