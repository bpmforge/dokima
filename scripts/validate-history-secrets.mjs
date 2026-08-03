#!/usr/bin/env node
// validate-history-secrets.mjs — release-gate secrets scanner for git HISTORY
// (ticket W10-27; durable fix for docs/work/SECURITY_RELEASE_BLOCKER_2026-08-02.md).
//
// WHY THIS EXISTS, precisely. content/validators/secrets-scan.sh (W3-13, SC-06)
// greps the working TREE and passes `--exclude-dir=.git`, so by construction it
// can never see history. A credential that is deleted from the tree and added
// to .gitignore reads CLEAN there while every clone still carries it. That is
// not a hypothetical: the Ed25519 content-signing private key sat in pushed
// history from 2026-07-20 to 2026-08-02 with the tree scanner green the whole
// time. This scanner reads what the tree scanner cannot.
//
// NO EXTERNAL BINARY (Law 9, local-first honesty). git plumbing + Node only —
// no gitleaks, no trufflehog. Measured on this repo: 1063 commits, 3951
// reachable blobs, ~295 MB of content, ~1.1s. A dependency would buy nothing
// and cost a prerequisite that is absent on most machines.
//
// A matched value is NEVER printed in full — masked prefix plus length, the
// same rule as secrets-scan.sh's mask(). A scanner must not become the leak it
// exists to prevent (Law 8).
//
// Usage:
//   node scripts/validate-history-secrets.mjs [repo-root]
//   node scripts/validate-history-secrets.mjs --update-baseline [repo-root]
//   node scripts/validate-history-secrets.mjs --verify-remote-refs [repo-root]   (CI)
//
// Exit 0 clean · 1 findings · 2 error (same contract as the validator pack).
// Exit 2 covers "could not scan": not a repo, a shallow clone, no history, or
// any git spawn failure. Unknown is not clean.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The same six categories as content/validators/secrets-scan.sh:44-50 and
 * packages/shared/src/secrets/patterns.ts. Kept as source strings so the two
 * scanners can be diffed by eye; compiled per-use with the `g` flag.
 *
 * These patterns provably do not match their own source text (every one needs
 * a character class member immediately after a literal prefix, and the source
 * has `[` there), so this file needs no self-exclusion — and therefore offers
 * no self-exclusion hole.
 */
export const SECRET_PATTERNS = [
  ['github-token', 'gh[pousr]_[A-Za-z0-9]{20,}'],
  ['aws-access-key-id', 'AKIA[0-9A-Z]{16}'],
  ['openai-style-key', 'sk-[A-Za-z0-9_-]{16,}'],
  ['slack-token', 'xox[baprs]-[A-Za-z0-9-]{10,}'],
  ['pem-private-key', '-----BEGIN [A-Z ]*PRIVATE KEY-----'],
  ['db-connection-credentials', '(postgres(ql)?|mysql|mongodb(\\+srv)?)://[^:@\\s]+:[^@\\s]+@'],
];

/** git's own binary heuristic: a NUL byte inside the first 8000 bytes. */
const BINARY_PROBE_BYTES = 8000;

/** First 4 characters plus a length marker — never the value. */
export function mask(value) {
  return `${value.slice(0, 4)}...REDACTED(${value.length} chars)`;
}

/**
 * A finding's identity is the VALUE, not the file it sits in. Path-scoped
 * baselines have two defects this avoids: a real credential can hide inside an
 * already-baselined fixture file, and the baseline churns every time such a
 * file is edited (each edit is a new blob). A fingerprint goes stale only when
 * the fixture value itself changes.
 */
export function fingerprint(category, value) {
  return `${category}:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function git(root, args, { maxBuffer = 1 << 28, input } = {}) {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer, input });
  if (res.error) throw new Error(`git ${args[0]} failed to spawn: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} exited ${res.status}: ${(res.stderr || '').trim()}`);
  return res.stdout;
}

/**
 * Refuse to report clean when the local ref set is narrower than the remote's.
 *
 * Measured, not assumed: a checkout fetched with the single-ref refspec
 * `+refs/heads/main:refs/remotes/origin/main` reports **OK** on a repo carrying
 * a leaked key on another branch. It is not shallow, so the shallowness check
 * never fires — the denominator is just silently smaller. That is precisely the
 * failure this whole gate exists to kill, so the scan is not allowed to trust
 * that its caller fetched everything.
 *
 * Opt-in (`--verify-remote-refs`) because it is the one network call in this
 * file: CI has already talked to the remote it cloned from, while a local run
 * must stay offline (Law 9). Off by default, on in CI.
 */
function assertRemoteRefsPresent(root) {
  const remotes = git(root, ['remote']).split('\n').filter(Boolean);
  if (remotes.length === 0) throw new Error('--verify-remote-refs was requested but this repo has no remote');
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];

  const local = new Set(git(root, ['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean));
  const missing = [];
  for (const line of git(root, ['ls-remote', '--heads', remote]).split('\n')) {
    const name = line.split('\t')[1];
    if (!name) continue;
    const branch = name.slice('refs/heads/'.length);
    if (!local.has(name) && !local.has(`refs/remotes/${remote}/${branch}`)) missing.push(branch);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} branch(es) on '${remote}' have no local ref, so --all would scan a narrower history ` +
        `than exists: ${missing.join(', ')}. Fetch them before scanning: ` +
        `git fetch --prune ${remote} '+refs/heads/*:refs/remotes/${remote}/*'`,
    );
  }
}

/** Refuse to report clean on a repo whose history is absent or truncated. */
function assertScannableHistory(root) {
  if (!existsSync(root)) throw new Error(`no such directory: ${root}`);
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']).trim();
  if (inside !== 'true') throw new Error(`not a git work tree: ${root}`);
  const gitDir = resolve(root, git(root, ['rev-parse', '--git-dir']).trim());
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true' || existsSync(join(gitDir, 'shallow'))) {
    throw new Error(
      'shallow clone — history is truncated, so a clean result would be meaningless. ' +
        'In CI set `fetch-depth: 0` on actions/checkout.',
    );
  }
}

/**
 * Every scannable object reachable from any ref: file contents (blobs), COMMIT
 * MESSAGES, and annotated tag messages.
 *
 * Commits matter as much as blobs and are easy to miss — `git rev-list
 * --objects` prints them with no path, so a parser that keys on the space
 * separator drops them silently. A credential pasted into a commit message is
 * in published history exactly like one in a file, and no amount of editing the
 * tree removes it.
 */
function reachableObjects(root) {
  const pathBySha = new Map();
  for (const line of git(root, ['rev-list', '--objects', '--all']).split('\n')) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    const sha = sp > 0 ? line.slice(0, sp) : line;
    if (!pathBySha.has(sha)) pathBySha.set(sha, sp > 0 ? line.slice(sp + 1) : null);
  }
  // Annotated tags hang off refs/tags and are not enumerated by rev-list --objects.
  for (const line of git(root, ['for-each-ref', '--format=%(objectname)', 'refs/tags']).split('\n')) {
    if (line && !pathBySha.has(line)) pathBySha.set(line, null);
  }
  if (pathBySha.size === 0) throw new Error('no reachable objects — nothing to scan, refusing to report clean');

  const shas = [...pathBySha.keys()];
  const scannable = [];
  const typeBySha = new Map();
  for (const line of git(root, ['cat-file', '--batch-check', '--buffer'], { input: shas.join('\n') }).split('\n')) {
    const [sha, type] = line.split(' ');
    if (type === 'blob' || type === 'commit' || type === 'tag') {
      scannable.push(sha);
      typeBySha.set(sha, type);
    }
  }
  return { scannable, pathBySha, typeBySha };
}

/** Where a human should go looking. A commit has no path — name the message. */
function describeLocation(sha, type, path) {
  if (type === 'commit') return `commit message ${sha.slice(0, 7)}`;
  if (type === 'tag') return `tag message ${sha.slice(0, 7)}`;
  return path ?? '(unknown path)';
}

/** Every pattern hit in one blob's text. Exported so the match rules are unit-testable. */
export function scanText(text) {
  const hits = [];
  for (const [category, source] of SECRET_PATTERNS) {
    for (const m of text.matchAll(new RegExp(source, 'g'))) {
      hits.push({ category, value: m[0] });
    }
  }
  return hits;
}

/**
 * Scan every reachable object. Returns findings keyed by fingerprint (one entry
 * per distinct secret VALUE, however many objects carry it) plus scan stats.
 */
export function scanHistory(root, { verifyRemoteRefs = false } = {}) {
  assertScannableHistory(root);
  if (verifyRemoteRefs) assertRemoteRefsPresent(root);
  const { scannable, pathBySha, typeBySha } = reachableObjects(root);

  const res = spawnSync('git', ['-C', root, 'cat-file', '--batch', '--buffer'], {
    input: scannable.join('\n') + '\n',
    maxBuffer: 1 << 30,
  });
  if (res.error) throw new Error(`git cat-file failed to spawn: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`git cat-file exited ${res.status}`);
  const buf = res.stdout;

  const byFingerprint = new Map();
  let scanned = 0;
  let binarySkipped = 0;
  let offset = 0;
  while (offset < buf.length) {
    const nl = buf.indexOf(10, offset);
    if (nl < 0) break;
    const [sha, , sizeText] = buf.toString('latin1', offset, nl).split(' ');
    const size = Number(sizeText);
    if (!Number.isFinite(size)) throw new Error(`malformed cat-file header for ${sha}`);
    const body = buf.subarray(nl + 1, nl + 1 + size);
    offset = nl + 1 + size + 1;

    if (body.subarray(0, Math.min(BINARY_PROBE_BYTES, body.length)).includes(0)) {
      binarySkipped++;
      continue;
    }
    scanned++;
    for (const { category, value } of scanText(body.toString('utf8'))) {
      const fp = fingerprint(category, value);
      if (!byFingerprint.has(fp)) {
        const type = typeBySha.get(sha);
        byFingerprint.set(fp, {
          fingerprint: fp,
          category,
          masked: mask(value),
          seen_at: describeLocation(sha, type, pathBySha.get(sha)),
          object: sha,
          object_type: type,
        });
      }
    }
  }

  return {
    findings: [...byFingerprint.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    stats: {
      objects: scannable.length,
      scanned,
      binarySkipped,
      commits: Number(git(root, ['rev-list', '--all', '--count']).trim()),
      refs: git(root, ['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean).length,
    },
  };
}

export const BASELINE_FILE = 'scripts/history-secrets-baseline.json';

/**
 * Known-benign fingerprints (test fixtures, doc examples). Absent file = empty
 * baseline, which is the safe direction: everything gates.
 */
export function loadBaseline(root) {
  const file = join(root, BASELINE_FILE);
  if (!existsSync(file)) return new Set();
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return new Set((parsed.entries ?? []).map((e) => e.fingerprint));
}

function writeBaseline(root, findings) {
  const body = {
    version: 1,
    note:
      'Known-benign secret SHAPES in this repo’s history — test fixtures and documentation ' +
      'examples, never live credentials. Matching is on `fingerprint` (category + sha256 of the ' +
      'matched value) alone; `seen_at` is a review aid, not a key, so a NEW value in a listed file ' +
      'still fails the gate. Regenerate with `--update-baseline`; every change to this file must be ' +
      'read in the diff, because adding a line here is how a real leak would be silenced.',
    generated_from_commits: findings.stats.commits,
    entries: findings.findings.map(({ fingerprint: fp, category, seen_at }) => ({ fingerprint: fp, category, seen_at })),
  };
  writeFileSync(join(root, BASELINE_FILE), JSON.stringify(body, null, 2) + '\n');
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const update = argv.includes('--update-baseline');
  const verifyRemoteRefs = argv.includes('--verify-remote-refs');
  const root = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

  let result;
  try {
    result = scanHistory(root, { verifyRemoteRefs });
  } catch (e) {
    console.error(`ERROR history-secrets: ${e.message}`);
    return 2;
  }

  const { findings, stats } = result;
  console.log(
    `Scanned ${stats.commits} commits over ${stats.refs} refs · ${stats.objects} reachable objects — file contents, ` +
      `commit and tag messages (${stats.scanned} text, ${stats.binarySkipped} binary skipped) under ${root}`,
  );

  if (update) {
    writeBaseline(root, result);
    console.log(`Baseline rewritten: ${findings.length} fingerprint(s) in ${BASELINE_FILE}. Review the diff before committing.`);
    return 0;
  }

  let baseline;
  try {
    baseline = loadBaseline(root);
  } catch (e) {
    console.error(`ERROR history-secrets: ${BASELINE_FILE} is unreadable (${e.message}) — refusing to report clean`);
    return 2;
  }

  const gating = findings.filter((f) => !baseline.has(f.fingerprint));
  console.log(`${findings.length} known credential shape(s) in history · ${baseline.size} baselined · ${gating.length} gating`);
  if (gating.length === 0) {
    console.log('OK: no un-baselined credential shapes in git history.');
    return 0;
  }

  console.error(`FAIL: ${gating.length} un-baselined credential shape(s) in git history:`);
  for (const f of gating) {
    console.error(`  - [${f.category}] ${f.seen_at} — ${f.masked}`);
    console.error(
      f.object_type === 'blob'
        ? `      blob ${f.object} · find the commit with: git log --all --oneline --find-object=${f.object}`
        : `      ${f.object_type} ${f.object} · inspect it with: git cat-file -p ${f.object}`,
    );
  }
  console.error(
    '\nA history hit is not fixed by deleting the file: rotate the credential first, then purge ' +
      'history and force-push (see docs/work/SECURITY_RELEASE_BLOCKER_2026-08-02.md). If this is a ' +
      `test fixture, add it to ${BASELINE_FILE} via --update-baseline.`,
  );
  return 1;
}

// Only run when executed directly, so the helpers above stay importable by the
// test (the lesson conductor.mjs learned the hard way — see conductor-lib.mjs).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
