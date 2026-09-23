/**
 * Findings the ticket did not introduce (W23-51).
 *
 * WHAT WENT WRONG LIVE. On the 2026-09-23 Vault autorun a ticket that added one
 * hex helper came back from review with `tool-deps: FINDINGS (14)` — fourteen
 * advisories in dependencies the ticket never touched. A review judges a
 * CHANGE; a finding that was already there at the ticket's base is a fact
 * about the project, and counting it against this ticket blocks every ticket
 * in that project forever while telling the maker to fix code it did not write.
 *
 * SO A FINDING IS COMPARED, NOT COUNTED. When a check reports findings on the
 * head, the same scanner runs over the base, and only findings the head has
 * MORE of are the ticket's. Compared as a multiset: two identical findings at
 * head against one at base is one introduced — a set comparison would call a
 * duplicated vulnerable line "pre-existing".
 *
 * AND IT FAILS CLOSED. A base that cannot be checked out or scanned leaves the
 * head's findings standing, with the reason said. The baseline can only ever
 * move a finding from "introduced" to "pre-existing" by measuring it at base.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CheckStatus,
  RunSecurityChecksOptions,
  SecurityToolAdapter,
  ToolRunResult,
} from './security-checks.js';

const execFileAsync = promisify(execFile);

/** Opengrep prefixes a rule id with its config path (`Users.me.rules.owasp.<id>`); the id is the last segment. */
function ruleIdOf(checkId: string): string {
  const segments = checkId.split('.');
  return segments[segments.length - 1] ?? checkId;
}

/**
 * Identity of an Opengrep/Semgrep finding: rule, file, and the matched text.
 * NOT the line number — an unrelated edit above a pre-existing finding moves
 * it, and a moved finding is not a new one. Not `extra.fingerprint` either:
 * measured on opengrep 1.25.0, two different matches of one rule in one file
 * share a fingerprint.
 */
export function sastFindingKeys(stdout: string): readonly string[] | null {
  let parsed: {
    results?: {
      check_id?: string;
      path?: string;
      extra?: { lines?: string };
    }[];
  };
  try {
    parsed = JSON.parse(stdout || '{}') as typeof parsed;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.results)) return null;
  return parsed.results.map(
    (r) =>
      `${ruleIdOf(r.check_id ?? '')}|${r.path ?? ''}|${(r.extra?.lines ?? '').replace(/\s+/g, ' ').trim()}`,
  );
}

/**
 * Identity of an `npm audit` finding: the vulnerable package, its severity and
 * the affected range. Severity `info` is not a finding here, matching the
 * adapter's own count.
 */
export function depsFindingKeys(stdout: string): readonly string[] | null {
  let parsed: {
    vulnerabilities?: Record<string, { severity?: string; range?: string }>;
  };
  try {
    parsed = JSON.parse(stdout || '{}') as typeof parsed;
  } catch {
    return null;
  }
  if (!parsed.vulnerabilities || typeof parsed.vulnerabilities !== 'object') return null;
  return Object.entries(parsed.vulnerabilities)
    .filter(([, v]) => v?.severity !== 'info')
    .map(([name, v]) => `${name}|${v?.severity ?? ''}|${v?.range ?? ''}`);
}

/**
 * W23-55: the bundled scanner's categories, as line-level patterns mirroring
 * `content/validators/secrets-scan.sh` (a test holds the two category sets
 * equal). Used ONLY to re-find the flagged value in memory; the value itself
 * never leaves this function.
 */
const SECRET_LINE_PATTERNS: Readonly<Record<string, RegExp>> = {
  'github-token': /gh[pousr]_[A-Za-z0-9]{20,}/g,
  'aws-access-key-id': /AKIA[0-9A-Z]{16}/g,
  'openai-style-key': /sk-[A-Za-z0-9_-]{16,}/g,
  'slack-token': /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  'pem-private-key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  'db-connection-credentials':
    /(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^:@\s]+:[^@\s]+@/g,
};

/**
 * Reads `rel` under `root` only if it RESOLVES to a regular file inside it —
 * the worktree is untrusted, and a symlinked file or directory could otherwise
 * point the core at anything on the host.
 */
async function readInside(root: string, rel: string): Promise<string | null> {
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(path.resolve(root, rel));
    const within = path.relative(realRoot, real);
    if (within === '' || within.startsWith('..') || path.isAbsolute(within)) return null;
    const stat = await fs.stat(real);
    return stat.isFile() ? await fs.readFile(real, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Identity of a secrets-scanner finding: category + file + a FINGERPRINT of
 * the secret itself (W23-55). The scanner prints only a mask, and its mask is
 * no identity: every AWS key masks to `AKIA...REDACTED(20 chars)`, and it
 * masks the file's first match rather than the flagged line's — so a key built
 * from the mask would call a replaced secret "pre-existing" and let a newly
 * committed one through. The core therefore re-reads the flagged line from the
 * tree that was scanned, re-matches the category, and hashes the match in
 * memory. A PEM block is hashed through its END line (every header is alike).
 * No line number (a moved secret is the same secret). Anything it cannot
 * re-find returns null, which keeps the head's findings standing.
 */
export async function secretsFindingKeys(
  stdout: string,
  root: string,
): Promise<readonly string[] | null> {
  let parsed: { items?: { category?: string; detail?: string }[] };
  try {
    parsed = JSON.parse(stdout || '{}') as typeof parsed;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.items)) return null;
  const files = new Map<string, Promise<string | null>>();
  const keys: string[] = [];
  for (const item of parsed.items) {
    const pattern = SECRET_LINE_PATTERNS[item.category ?? ''];
    const at = /^(.+):(\d+) \u2014 /.exec(item.detail ?? '');
    if (!pattern || !at) return null;
    const [, rel = '', lineNo = '0'] = at;
    if (!files.has(rel)) files.set(rel, readInside(root, rel));
    const text = await files.get(rel)!;
    if (text === null) return null;
    const lines = text.split('\n');
    const index = Number(lineNo) - 1;
    const matches = (lines[index] ?? '').match(pattern);
    if (!matches) return null;
    let material = matches.join('\0');
    if (item.category === 'pem-private-key') {
      const end = lines.findIndex(
        (l, i) => i >= index && /-----END [A-Z ]*PRIVATE KEY-----/.test(l),
      );
      material = lines.slice(index, end < 0 ? undefined : end + 1).join('\n');
    }
    const print = createHash('sha256').update(material).digest('hex').slice(0, 32);
    keys.push(`${item.category}|${rel}|${print}`);
  }
  return keys;
}

/** Multiset difference: what head has more of than base. */
export function introducedFindings(
  head: readonly string[],
  base: readonly string[],
): { readonly introduced: readonly string[]; readonly preexisting: number } {
  const remaining = new Map<string, number>();
  for (const key of base) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  const introduced: string[] = [];
  let preexisting = 0;
  for (const key of head) {
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      preexisting++;
    } else {
      introduced.push(key);
    }
  }
  return { introduced, preexisting };
}

/**
 * A read-only copy of `ref`'s tree in a temp directory, via `git archive` —
 * the project's `.git` gains no worktree entry and nothing is checked out.
 * Returns null when the ref cannot be archived; the caller then keeps the
 * head's findings. The caller removes the directory (`removeBaselineCheckout`).
 */
export async function archiveCheckout(
  repoPath: string,
  ref: string,
): Promise<string | null> {
  try {
    await execFileAsync('git', [
      '-C',
      repoPath,
      'rev-parse',
      '--verify',
      `${ref}^{tree}`,
    ]);
  } catch {
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-baseline-'));
  const closed = (child: ReturnType<typeof spawn>): Promise<boolean> =>
    new Promise((resolve) => {
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  const archive = spawn('git', ['-C', repoPath, 'archive', '--format=tar', ref], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const untar = spawn('tar', ['-x', '-C', dir], { stdio: ['pipe', 'ignore', 'ignore'] });
  archive.stdout.pipe(untar.stdin);
  const [archived, extracted] = await Promise.all([closed(archive), closed(untar)]);
  const ok = archived && extracted;
  if (!ok) {
    await removeBaselineCheckout(dir);
    return null;
  }
  return dir;
}

export async function removeBaselineCheckout(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Substitutes the runtime-owned placeholders — and nothing a session produced. */
export function expandArgs(
  adapter: SecurityToolAdapter,
  options: RunSecurityChecksOptions,
  cwd: string,
): string[] {
  return adapter.args.flatMap((arg) =>
    arg === '{cwd}'
      ? [cwd]
      : arg === '{validatorPath}'
        ? [options.secretsValidatorPath ?? '']
        : arg === '{sastConfig}'
          ? (options.sastRules?.configPaths ?? []).flatMap((p) => ['--config', p])
          : [arg],
  );
}

/**
 * W23-54: the runtime-owned host paths an adapter's command line names — the
 * pinned rule packs, the bundled scanner's directory (it sources `_lib.sh`
 * beside itself). A container runner mounts exactly these, read-only.
 */
export function runtimePathsOf(
  adapter: SecurityToolAdapter,
  options: RunSecurityChecksOptions,
): readonly string[] {
  if (adapter.args.includes('{sastConfig}')) return options.sastRules?.configPaths ?? [];
  if (adapter.args.includes('{validatorPath}') && options.secretsValidatorPath) {
    return [path.dirname(options.secretsValidatorPath)];
  }
  return [];
}

type Interpreted = {
  readonly status: CheckStatus;
  readonly reason: string | null;
  readonly findingCount: number;
  readonly preexistingCount?: number;
  readonly baselineRef?: string | null;
};

/**
 * W23-51: findings on the head are compared with the same scan of the base.
 * Only what the head has MORE of is this change's; everything else is
 * reported as pre-existing. Fails closed: no base, an unreadable output or a
 * base scan that did not complete leaves the head's findings standing.
 */
export async function compareWithBaseline(
  adapter: SecurityToolAdapter,
  options: RunSecurityChecksOptions,
  headRun: ToolRunResult,
  head: Interpreted,
  timeoutMs: number,
): Promise<Interpreted> {
  if (head.status !== 'findings' || !adapter.findingKeys || !options.baseline)
    return head;
  const ref = options.baseline.ref;
  const kept = (why: string): Interpreted => ({
    ...head,
    reason: `${head.findingCount} finding(s); not compared with base ${ref.slice(0, 12)} — ${why}`,
    baselineRef: null,
  });
  const headKeys = await adapter.findingKeys(headRun, options.cwd);
  if (!headKeys) return kept('the head output could not be itemised');
  const baseDir = await options.baseline.checkout();
  if (!baseDir) return kept('the base could not be checked out');
  const baseRun = await options.runTool(adapter, expandArgs(adapter, options, baseDir), {
    cwd: baseDir,
    allowNetwork: adapter.requiresNetwork && options.networkPolicy === 'network-allowed',
    timeoutMs,
    readOnlyPaths: runtimePathsOf(adapter, options),
  });
  const base = adapter.interpret(baseRun);
  const baseKeys =
    base.status === 'passed'
      ? []
      : base.status === 'findings'
        ? await adapter.findingKeys(baseRun, baseDir)
        : null;
  if (!baseKeys) return kept(`the base scan was ${base.status}`);
  const { introduced, preexisting } = introducedFindings(headKeys, baseKeys);
  const short = ref.slice(0, 12);
  if (introduced.length === 0) {
    return {
      status: 'passed',
      reason: `${preexisting} finding(s) already present at base ${short}; none introduced by this change`,
      findingCount: 0,
      preexistingCount: preexisting,
      baselineRef: ref,
    };
  }
  return {
    status: 'findings',
    reason:
      `${introduced.length} finding(s) introduced by this change` +
      (preexisting > 0 ? ` (${preexisting} more already present at base ${short})` : ''),
    findingCount: introduced.length,
    preexistingCount: preexisting,
    baselineRef: ref,
  };
}
