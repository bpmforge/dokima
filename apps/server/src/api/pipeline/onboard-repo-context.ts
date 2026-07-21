/**
 * Gathers real, read-only repo material for the onboard/analysis run's
 * `seedContext` (W8-09 fix, conductor RESET note). `createRealOnboardDispatch`
 * (`onboard-dispatch-port.ts`)'s `spawn` is a single-turn `provider.chat()`
 * call with no filesystem/tool access — going agentic (model-driven fs
 * reads) isn't Law-9-viable (no fake/local agentic spawn exists, and the
 * gateway `Provider` interface is `chat()`-only). Without this module,
 * `seedContext` was just `{ repoRoot }`, a path string the specialist had no
 * way to open — it was being asked to analyze a repo it could not see. This
 * gathers a directory listing, recent commit log, a handful of key doc
 * files, and a bounded sample of real source-file contents so the
 * single-turn completion has real material — including for the
 * security/code-analysis steps (semgrep-runner, attack-chainer, complexity
 * analyzer, ...), which need actual code, not just a filename table of
 * contents — and injects the same bundle into every step's `seedContext`
 * (the port only supports one shared `seedContext` per run — see
 * `packages/pipeline/src/run/types.ts`).
 *
 * Read-only, bounded, and defensive throughout: every candidate file read
 * and every git call tolerates absence/failure (a fresh, uncommitted, or
 * non-git project still gets a best-effort bundle rather than a thrown
 * error) and every list is capped so a huge repo can't blow the specialist's
 * context budget.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIRECTORY_LISTING_LIMIT = 400;
const COMMIT_LOG_LIMIT = 20;
const KEY_FILE_BYTE_LIMIT = 4000;
const WALK_VISIT_LIMIT = 5000;
const SOURCE_SAMPLE_LIMIT = 12;
const SOURCE_SAMPLE_BYTE_LIMIT = 2000;
const KEY_FILE_CANDIDATES = [
  'README.md',
  'Readme.md',
  'package.json',
  'CLAUDE.md',
  'AGENTS.md',
];
const WALK_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'target',
  'vendor',
]);
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
  '.c',
  '.cpp',
  '.cs',
]);
const TEST_PATH_PATTERN = /(\.(test|spec)\.\w+$)|(\/(__tests__|tests?)\/)/;

const UNIT_SEP = '\x1f';

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve({ stdout: err ? '' : stdout, ok: !err });
    });
  });
}

async function isGitRepo(repoRoot: string): Promise<boolean> {
  const res = await runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  return res.ok && res.stdout.trim() === 'true';
}

async function listFilesGit(repoRoot: string): Promise<string[]> {
  const res = await runGit(repoRoot, ['ls-files']);
  if (!res.ok) return [];
  return res.stdout.split('\n').filter(Boolean);
}

/** Fallback for a non-git (or freshly-`git init`'d, nothing committed) project. */
async function walkFiles(
  root: string,
  dir: string,
  visited: { count: number },
): Promise<string[]> {
  if (visited.count >= WALK_VISIT_LIMIT) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (visited.count >= WALK_VISIT_LIMIT) break;
    visited.count += 1;
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      out.push(...(await walkFiles(root, path.join(dir, entry.name), visited)));
    } else if (entry.isFile()) {
      out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
    }
  }
  return out;
}

export interface OnboardRepoCommit {
  readonly rev: string;
  readonly author: string;
  readonly at: string;
  readonly subject: string;
}

async function recentCommits(repoRoot: string): Promise<OnboardRepoCommit[]> {
  const res = await runGit(repoRoot, [
    'log',
    `-n${COMMIT_LOG_LIMIT}`,
    `--format=%H${UNIT_SEP}%an${UNIT_SEP}%aI${UNIT_SEP}%s`,
  ]);
  if (!res.ok) return [];
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [rev, author, at, subject] = line.split(UNIT_SEP);
      return {
        rev: rev ?? '',
        author: author ?? '',
        at: at ?? '',
        subject: subject ?? '',
      };
    });
}

async function readKeyFiles(repoRoot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of KEY_FILE_CANDIDATES) {
    try {
      const raw = await fs.readFile(path.join(repoRoot, name), 'utf8');
      out[name] =
        raw.length > KEY_FILE_BYTE_LIMIT
          ? `${raw.slice(0, KEY_FILE_BYTE_LIMIT)}\n...[truncated]`
          : raw;
    } catch {
      // absent — not every project has every candidate file, that's fine.
    }
  }
  return out;
}

function isSampleableSourceFile(relPath: string): boolean {
  if (!SOURCE_EXTENSIONS.has(path.extname(relPath))) return false;
  return !TEST_PATH_PATTERN.test(`/${relPath}`);
}

/** A deterministic, bounded sample of real source-file contents (not just
 * their names) — the sample specialists (semgrep-runner, complexity
 * analyzer, attack-chainer, ...) need to actually see code. Tolerates an
 * unreadable/binary file despite the extension match by skipping it, same
 * defensiveness as `readKeyFiles`. */
async function sampleSourceFiles(
  repoRoot: string,
  files: readonly string[],
): Promise<{ samples: Record<string, string>; truncated: boolean }> {
  const candidates = files.filter(isSampleableSourceFile);
  const chosen = candidates.slice(0, SOURCE_SAMPLE_LIMIT);
  const samples: Record<string, string> = {};
  for (const rel of chosen) {
    try {
      const raw = await fs.readFile(path.join(repoRoot, rel), 'utf8');
      samples[rel] =
        raw.length > SOURCE_SAMPLE_BYTE_LIMIT
          ? `${raw.slice(0, SOURCE_SAMPLE_BYTE_LIMIT)}\n...[truncated]`
          : raw;
    } catch {
      // unreadable/binary despite the extension match — skip, don't fail the gather.
    }
  }
  return { samples, truncated: candidates.length > chosen.length };
}

export interface OnboardRepoContext {
  readonly repoRoot: string;
  readonly isGitRepo: boolean;
  readonly directoryListing: readonly string[];
  readonly directoryListingTruncated: boolean;
  readonly recentCommits: readonly OnboardRepoCommit[];
  readonly keyFiles: Readonly<Record<string, string>>;
  /** A bounded, deterministic sample of real source-file contents (never
   * test files) so code/security specialists have actual code to analyze,
   * not just filenames — see module header. */
  readonly sourceSamples: Readonly<Record<string, string>>;
  readonly sourceSamplesTruncated: boolean;
}

/** Builds the real repo-context bundle injected into every onboard step's
 * `seedContext` (`onboard-run.ts`). Never throws — a project with no git
 * history, no key files, or an unreadable tree still yields a (possibly
 * empty) honest bundle rather than failing the whole run. */
export async function gatherOnboardRepoContext(
  repoRoot: string,
): Promise<OnboardRepoContext> {
  const gitRepo = await isGitRepo(repoRoot);
  const allFiles = gitRepo
    ? await listFilesGit(repoRoot)
    : await walkFiles(repoRoot, repoRoot, { count: 0 });
  const sorted = [...allFiles].sort();
  const { samples: sourceSamples, truncated: sourceSamplesTruncated } =
    await sampleSourceFiles(repoRoot, sorted);
  return {
    repoRoot,
    isGitRepo: gitRepo,
    directoryListing: sorted.slice(0, DIRECTORY_LISTING_LIMIT),
    directoryListingTruncated: sorted.length > DIRECTORY_LISTING_LIMIT,
    recentCommits: gitRepo ? await recentCommits(repoRoot) : [],
    keyFiles: await readKeyFiles(repoRoot),
    sourceSamples,
    sourceSamplesTruncated,
  };
}
