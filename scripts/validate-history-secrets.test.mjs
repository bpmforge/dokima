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

import { fingerprint, mask, scanText, SECRET_PATTERNS,
  planChunks,
} from './validate-history-secrets.mjs';

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

  it('a secret pasted into a COMMIT MESSAGE is caught — it is history too, and no tree edit removes it', () => {
    const dir = newRepo();
    const secret = shape.openai();
    writeFileSync(path.join(dir, 'note.txt'), 'nothing to see\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', `rotate creds\n\nold key was ${secret}`);

    // The file tree is spotless. `git rev-list --objects` prints commit objects
    // with no path, so a parser keyed on the space separator drops them silently.
    const tree = spawnSync('bash', [TREE_SCANNER, dir], { encoding: 'utf8', env: GIT_ENV });
    expect(tree.status).toBe(0);

    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('commit message');
    expect(res.stderr).toContain('git cat-file -p');
    expect(res.stdout + res.stderr).not.toContain(secret);
  });

  it('an annotated TAG message is caught — tags are not enumerated by rev-list --objects', () => {
    const dir = newRepo();
    const secret = shape.githubOther();
    git(dir, 'tag', '-a', 'v0.0.1', '-m', `release cut; deploy token ${secret}`);

    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('tag message');
    expect(res.stdout + res.stderr).not.toContain(secret);
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

  it('RED FIXTURE: a single-ref checkout hides a leak on another branch — and --verify-remote-refs refuses it', () => {
    const origin = newRepo();
    git(origin, 'checkout', '-qb', 'feature');
    plantAndHide(origin, 'ci/token.txt', shape.github(), { keepInTree: true });
    git(origin, 'checkout', '-q', 'main');

    // Exactly what a narrow refspec produces: full history of ONE branch. Not
    // shallow — so the shallowness check never fires — just a smaller denominator.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-hist-narrow-'));
    scratch.push(dir);
    const target = path.join(dir, 'repo');
    execFileSync('git', ['init', '-q', target], { env: GIT_ENV });
    git(target, 'remote', 'add', 'origin', `file://${origin}`);
    git(target, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    git(target, 'checkout', '-qB', 'main', 'refs/remotes/origin/main');

    // The defect, demonstrated: a clean bill of health over a repo whose other
    // branch carries a live-shaped token.
    const blind = run(target);
    expect(blind.status).toBe(0);
    expect(blind.stdout).toContain('OK: no un-baselined credential shapes');

    // The guard. Same repo, same history, refuses to grade it.
    const guarded = run(target, '--verify-remote-refs');
    expect(guarded.status).toBe(2);
    expect(guarded.stderr).toContain('feature');
    expect(guarded.stderr).toContain('narrower history');

    // And once the missing branch is present, the leak is found.
    git(target, 'fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*');
    const full = run(target, '--verify-remote-refs');
    expect(full.status).toBe(1);
    expect(full.stderr).toContain('github-token');
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
  // 60s, not the 5s default — same lesson as conductor-lib.test.mjs:1137. This
  // walks EVERY object reachable from every ref: 1579 commits over 112 refs and
  // ~7155 objects as of 2026-08-19, which is 1.9s of CPU on an idle machine and
  // well over 5s when the other 452 files in the workspace are competing for
  // cores. It surfaced as a flake that failed 3 runs in 5 and could not be
  // reproduced alone — the shape of a contention bug, not a code one.
  //
  // The budget is generous on purpose. This assertion is about whether an
  // un-baselined credential shape exists in history, never about how fast the
  // walk is, and the walk gets slower with every commit ever added. A timeout
  // tight enough to trip on load tests the machine, not the invariant — and a
  // secrets gate that goes red for reasons unrelated to secrets is one people
  // learn to ignore.
  it("passes its own gate — every shape in Dokima's history is baselined and benign", () => {
    const res = run(path.join(here, '..'));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  }, 60_000);
});

describe('W21-84 — history is read in bounded chunks', () => {
  /**
   * Dokima's own history reached 1.01 GiB of blobs against a `maxBuffer` of
   * 1 << 30, and the validator began failing with `spawnSync git ENOBUFS` —
   * which reads as a broken tool, not a repo that outgrew a constant. The
   * gate went red on a clean tree.
   */
  const sizes = (entries) => new Map(entries);

  it('covers every object exactly once, in order', () => {
    const shas = ['a', 'b', 'c', 'd'];
    const chunks = planChunks(shas, sizes([['a', 60], ['b', 60], ['c', 60], ['d', 60]]), 100);
    expect(chunks.flat()).toEqual(shas);
    expect(new Set(chunks.flat()).size).toBe(shas.length);
  });

  it('splits when the cap would be exceeded', () => {
    const chunks = planChunks(['a', 'b', 'c'], sizes([['a', 60], ['b', 60], ['c', 10]]), 100);
    expect(chunks).toEqual([['a'], ['b', 'c']]);
  });

  it('an object larger than the cap gets its own chunk rather than being skipped', () => {
    const chunks = planChunks(['a', 'big', 'b'], sizes([['a', 10], ['big', 999], ['b', 10]]), 100);
    expect(chunks.flat()).toEqual(['a', 'big', 'b']);
    expect(chunks.some((c) => c.length === 1 && c[0] === 'big')).toBe(true);
  });

  it('an object with no recorded size still gets scanned', () => {
    expect(planChunks(['a'], sizes([]), 100).flat()).toEqual(['a']);
  });

  it('no objects means no chunks, never an empty batch handed to git', () => {
    expect(planChunks([], sizes([]), 100)).toEqual([]);
  });
});
