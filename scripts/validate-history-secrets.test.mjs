// validate-history-secrets.test.mjs — the planted-defect harness for the
// history scanner (W10-27; docs/TESTING.md §6). A gate that cannot be made to
// fail is not a gate, so every assertion here plants a real credential shape
// and proves the scanner reacts to it.
//
// FIXTURE SECRETS ARE ASSEMBLED AT RUNTIME, never written as literals. This
// scanner reads git HISTORY: a literal here would be committed once and then
// gate every future run of this repo forever, so each fixture would have to be
// permanently baselined — and a baseline entry is exactly the thing a real leak
// would hide behind. Interpolation breaks the pattern in the source text while
// the scanner still sees the fully-formed shape at runtime. (This deliberately
// diverges from the older packages/shared/src/secrets/secrets-scan-validator.test.ts,
// which predates history scanning and whose literals are in the baseline today.)

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { fingerprint, mask, scanText, SECRET_PATTERNS } from './validate-history-secrets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'validate-history-secrets.mjs');
const TREE_SCANNER = path.join(here, '..', 'content', 'validators', 'secrets-scan.sh');

// Real shapes, broken across an interpolation boundary in the source only.
const shape = {
  pem: () => `-----BEGIN ${'RSA'} PRIVATE KEY-----\nZmFrZQ==\n-----END RSA PRIVATE KEY-----\n`,
  github: () => `gh${'p'}_${'0'.repeat(20)}Fixture`,
  githubOther: () => `gh${'p'}_${'1'.repeat(20)}Different`,
  openai: () => `sk${'-'}${'a'.repeat(24)}`,
};

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** An isolated repo: no global/system git config, so a user's hooks or aliases can't reach it. */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
  });

function newRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-hist-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

const run = (root, ...args) => spawnSync('node', [SCRIPT, ...args, root], { encoding: 'utf8', env: GIT_ENV });

function writeBaseline(dir, entries) {
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'scripts', 'history-secrets-baseline.json'), JSON.stringify({ version: 1, entries }, null, 2));
}

/** Commit a secret, then delete it from the tree and .gitignore it — the exact 2026-08-02 shape. */
function plantAndHide(dir, relPath, secret, { keepInTree = false } = {}) {
  const abs = path.join(dir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, secret);
  git(dir, 'add', '-Af');
  git(dir, 'commit', '-q', '-m', `add ${relPath}`);
  const sha = git(dir, 'rev-parse', 'HEAD').trim();
  if (!keepInTree) {
    rmSync(abs);
    writeFileSync(path.join(dir, '.gitignore'), `${relPath}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'remove key from tree and gitignore it');
  }
  return sha;
}

describe('history-secrets: pure helpers', () => {
  it('masks a value to a 4-char prefix and a length, never the value', () => {
    const secret = shape.github();
    const masked = mask(secret);
    expect(masked).toBe(`ghp_...REDACTED(${secret.length} chars)`);
    expect(masked).not.toContain(secret.slice(4));
  });

  it('fingerprints by value, so the same secret in two files is one finding', () => {
    const secret = shape.openai();
    expect(fingerprint('openai-style-key', secret)).toBe(fingerprint('openai-style-key', secret));
    expect(fingerprint('openai-style-key', secret)).not.toBe(fingerprint('openai-style-key', shape.github()));
    expect(fingerprint('openai-style-key', secret)).not.toContain(secret);
  });

  it('matches every documented category and finds every occurrence, not just the first', () => {
    const hits = scanText([shape.pem(), shape.github(), shape.githubOther(), shape.openai()].join('\n'));
    expect(hits.filter((h) => h.category === 'github-token')).toHaveLength(2);
    expect(new Set(hits.map((h) => h.category))).toEqual(new Set(['pem-private-key', 'github-token', 'openai-style-key']));
  });

  it('does not match its own pattern definitions (no self-exclusion hole is needed)', () => {
    expect(scanText(SECRET_PATTERNS.map(([c, p]) => `${c}|${p}`).join('\n'))).toEqual([]);
  });
});

describe('history-secrets: the gap this ticket closes', () => {
  it('RED FIXTURE: a key deleted from the tree and gitignored is clean to the TREE scanner and caught here', () => {
    const dir = newRepo();

    // Control first. A "the tree scanner reads clean" assertion is worthless if
    // the invocation is simply broken, so prove it CAN see this exact key while
    // the key is still in the tree. Only then does its later silence mean blind.
    const inTree = newRepo();
    plantAndHide(inTree, '.keys/fixture-private.pem', shape.pem(), { keepInTree: true });
    const control = spawnSync('bash', [TREE_SCANNER, inTree], { encoding: 'utf8', env: GIT_ENV });
    expect(control.status).toBe(1);
    expect(control.stdout).toContain('pem-private-key');

    const sha = plantAndHide(dir, '.keys/fixture-private.pem', shape.pem());

    // The premise of W10-27, now proven rather than asserted: secrets-scan.sh
    // (W3-13, SC-06) greps the working tree with --exclude-dir=.git, so once the
    // file is deleted and gitignored the same scanner that just caught it reads CLEAN.
    const tree = spawnSync('bash', [TREE_SCANNER, dir], { encoding: 'utf8', env: GIT_ENV });
    expect(tree.status).toBe(0);

    // The history scanner sees it, and hands over the command that names the commit.
    const hist = run(dir);
    expect(hist.status).toBe(1);
    expect(hist.stderr).toContain('pem-private-key');
    expect(hist.stderr).toContain('--find-object=');

    const blob = /--find-object=([0-9a-f]{40})/.exec(hist.stderr)?.[1];
    expect(blob).toBeTruthy();
    expect(git(dir, 'log', '--all', '--oneline', `--find-object=${blob}`)).toContain(sha.slice(0, 7));
  });

  it('never prints a raw secret on either stream', () => {
    const dir = newRepo();
    const secret = shape.github();
    plantAndHide(dir, 'ci/token.txt', secret);
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).not.toContain(secret);
    expect(res.stderr).toContain('ghp_...REDACTED');
  });
});

describe('history-secrets: the baseline suppresses shapes, not files', () => {
  it('a baselined fingerprint stops gating', () => {
    const dir = newRepo();
    const secret = shape.github();
    plantAndHide(dir, 'fixtures/token.txt', secret, { keepInTree: true });
    expect(run(dir).status).toBe(1);

    writeBaseline(dir, [{ fingerprint: fingerprint('github-token', secret), category: 'github-token' }]);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'baseline the fixture');

    const res = run(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK: no un-baselined credential shapes');
  });

  it('a NEW value in an already-baselined file still fails — the reason the baseline is not path-scoped', () => {
    const dir = newRepo();
    const known = shape.github();
    plantAndHide(dir, 'fixtures/token.txt', known, { keepInTree: true });
    writeBaseline(dir, [{ fingerprint: fingerprint('github-token', known), category: 'github-token' }]);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'baseline');
    expect(run(dir).status).toBe(0);

    writeFileSync(path.join(dir, 'fixtures', 'token.txt'), `${known}\n${shape.githubOther()}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'a real leak hiding in a baselined fixture file');

    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('1 un-baselined credential shape');
  });
});

describe('history-secrets: fails closed, because unknown is not clean', () => {
  it('a shallow clone exits 2 rather than reporting a vacuous pass', () => {
    const origin = newRepo();
    plantAndHide(origin, 'ci/token.txt', shape.github());
    const clone = mkdtempSync(path.join(os.tmpdir(), 'dokima-hist-shallow-'));
    scratch.push(clone);
    const target = path.join(clone, 'repo');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, target], { env: GIT_ENV });

    // The truncated clone genuinely no longer carries the offending blob — which
    // is exactly why reporting 0 here would be a gate that cannot fail.
    const res = run(target);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('shallow');
    expect(res.stderr).toContain('fetch-depth: 0');
  });

  it('a repo with no commits exits 2, not 0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-hist-empty-'));
    scratch.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    const res = run(dir);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('nothing to scan');
  });

  it('a directory that is not a git work tree exits 2', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-hist-bare-'));
    scratch.push(dir);
    expect(run(dir).status).toBe(2);
  });

  it('an unreadable baseline exits 2 — a corrupt allowlist must not read as an empty one', () => {
    const dir = newRepo();
    mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    writeFileSync(path.join(dir, 'scripts', 'history-secrets-baseline.json'), '{ not json');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'corrupt baseline');
    const res = run(dir);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('refusing to report clean');
  });
});

describe('history-secrets: this repo', () => {
  it("passes its own gate — every shape in Dokima's history is baselined and benign", () => {
    const res = run(path.join(here, '..'));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });
});
