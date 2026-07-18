/**
 * Read-only `git` CLI wrapper for the Artifact Viewer (FR-C3: "Docs live on
 * disk in the project repo — the viewer is a window onto git-visible
 * files"). `packages/git` already wraps `execa` for this (`git-cli.ts`),
 * but it's only a devDependency of `apps/server` (test-only precedent:
 * `apps/server/src/cli/run-cmd.test.ts` is the sole importer) and
 * `apps/server/package.json` sits outside this ticket's write_scope (same
 * wall `server.ts`'s own header comment documents for
 * `@fastify/websocket`/`@fastify/static`) — shells out to the `git` binary
 * via `node:child_process` instead, mirroring that established pattern.
 * Every function here is a read (`log`/`show`/`ls-files`/`ls-tree`/`branch`/
 * `merge-base`); nothing here ever mutates the repo.
 *
 * Symlink defense (W1-07 class, W4-05 review HIGH): a git-tracked symlink
 * inside `docs/` can point at `../.shipwright/state.db` or `../.env`.
 * `readWorkingTree()` used to `fs.readFile(path.join(projectPath,
 * filePath))` directly, which follows OS symlinks — the lexical
 * `isSafeRelativePath` check (artifacts-helpers.ts) only ever saw the
 * *symlink's own* path (`docs/leak.md`), never its target, so a dot-path
 * target sailed straight through. `resolvesToSafeRealPath` below mirrors
 * `packages/git/src/scope.ts`'s `resolvesWithinRoot` (realpath the target,
 * check it stays under the project root) plus applies the *same*
 * dot-prefix rule to the resolved-and-rerooted path — a symlink that
 * escapes the root outright (`path.relative` starts with `..`) and a
 * symlink that resolves to an in-root dot-path (`.shipwright/state.db`,
 * lexically safe as a *target* but never a legitimate artifact) are both
 * refused. `showAtRev` reads via `git show rev:path`, which returns the
 * *blob content* for a tracked symlink (the target string itself, e.g.
 * `../.shipwright/state.db`) rather than following it — no filesystem
 * symlink-follow is possible through it — but `isSymlinkAtRev` still
 * refuses a symlink tree entry outright so the viewer never renders a
 * target-path string as if it were the deliverable's real content.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isSafeGitRevision, isSafeRelativePath } from './artifacts-helpers.js';

interface GitResult {
  stdout: string;
  ok: boolean;
}

function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve({ stdout: err ? '' : stdout, ok: !err });
    });
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return res.ok && res.stdout.trim() === 'true';
}

/** Recursive `.md` file walk (git-repo-less fallback — a brand-new project's docs/ has no commits yet). */
async function walkMarkdown(root: string, dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdown(root, full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Markdown files under `subdir` (default `docs`), git-tracked when the
 * project is a git repo (canonical per FR-C3), else a plain filesystem
 * walk so an un-initialized project still shows its docs honestly.
 */
export async function listMarkdownFiles(
  projectPath: string,
  subdir = 'docs',
): Promise<string[]> {
  if (await isGitRepo(projectPath)) {
    const res = await runGit(projectPath, [
      'ls-files',
      '--',
      `${subdir}/**/*.md`,
      `${subdir}/*.md`,
    ]);
    if (res.ok) {
      const files = res.stdout.split('\n').filter(Boolean);
      return Array.from(new Set(files)).sort();
    }
  }
  const files = await walkMarkdown(projectPath, path.join(projectPath, subdir));
  return files.sort();
}

export interface GitLogEntry {
  rev: string;
  author: string;
  at: string;
  subject: string;
}

const UNIT_SEP = '\x1f';

/** `--follow` version history for one path, newest first, capped at `limit`. */
export async function logForPath(
  projectPath: string,
  filePath: string,
  limit = 50,
): Promise<GitLogEntry[]> {
  if (!(await isGitRepo(projectPath))) return [];
  const res = await runGit(projectPath, [
    'log',
    '--follow',
    `-n${limit}`,
    `--format=%H${UNIT_SEP}%an${UNIT_SEP}%aI${UNIT_SEP}%s`,
    '--',
    filePath,
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

/** `true` if the tree entry at `rev:filePath` is a symlink (git mode `120000`) — see module header. */
async function isSymlinkAtRev(
  projectPath: string,
  rev: string,
  filePath: string,
): Promise<boolean> {
  const res = await runGit(projectPath, ['ls-tree', rev, '--', filePath]);
  if (!res.ok) return false;
  return res.stdout.trim().startsWith('120000 ');
}

/** File content at a revision (`HEAD`, a hash, or a branch name); `null` if the path doesn't exist there or is a symlink entry. */
export async function showAtRev(
  projectPath: string,
  rev: string,
  filePath: string,
): Promise<string | null> {
  if (!isSafeGitRevision(rev)) return null;
  if (!(await isGitRepo(projectPath))) return null;
  if (await isSymlinkAtRev(projectPath, rev, filePath)) return null;
  const res = await runGit(projectPath, ['show', `${rev}:${filePath}`]);
  return res.ok ? res.stdout : null;
}

/**
 * `true` if `absPath` realpath-resolves to somewhere under `projectPath`
 * that is itself a "safe" relative path (no dot-prefixed segment) — the
 * check applied to the *resolved* target, mirroring
 * `packages/git/src/scope.ts`'s `resolvesWithinRoot` plus the SC-01
 * dot-prefix rule (module header).
 */
async function resolvesToSafeRealPath(
  projectPath: string,
  absPath: string,
): Promise<string | null> {
  let real: string;
  try {
    real = await fs.realpath(absPath);
  } catch {
    return null;
  }
  const realRoot = await fs.realpath(projectPath);
  const relative = path.relative(realRoot, real);
  if (relative === '') return null;
  const normalized = relative.split(path.sep).join('/');
  if (!isSafeRelativePath(normalized)) return null;
  return real;
}

/**
 * Live working-tree content (uncommitted edits included) — falls back to
 * `showAtRev(HEAD, …)` only when the path is simply absent on disk. A path
 * that resolves (via symlink or otherwise) outside the project root, or
 * onto a dot-prefixed target, is refused outright (`null`) and never falls
 * through to the history read (module header — that fallback must not
 * become a bypass).
 */
export async function readWorkingTree(
  projectPath: string,
  filePath: string,
): Promise<string | null> {
  const absPath = path.join(projectPath, filePath);
  let lexists = true;
  try {
    await fs.lstat(absPath);
  } catch {
    lexists = false;
  }
  if (!lexists) {
    return showAtRev(projectPath, 'HEAD', filePath);
  }
  const real = await resolvesToSafeRealPath(projectPath, absPath);
  if (!real) return null;
  try {
    return await fs.readFile(real, 'utf8');
  } catch {
    return showAtRev(projectPath, 'HEAD', filePath);
  }
}

/**
 * Local branch matching `sw/<ticketId-lower>-*` (worktree naming law,
 * `packages/git/src/worktree.ts`'s `branchNameFor`). Returns the first
 * match; `null` if the ticket has no branch (not yet claimed, or claimed
 * outside this convention).
 */
export async function findTicketBranch(
  projectPath: string,
  ticketId: string,
): Promise<string | null> {
  if (!(await isGitRepo(projectPath))) return null;
  const prefix = `sw/${ticketId.toLowerCase()}`;
  const res = await runGit(projectPath, [
    'branch',
    '--list',
    '--format=%(refname:short)',
    `${prefix}*`,
  ]);
  if (!res.ok) return null;
  const branches = res.stdout.split('\n').filter(Boolean);
  return branches[0] ?? null;
}

/** `main` if it exists as a local branch, else the repo's current branch (single-branch fresh project). */
export async function defaultBaseBranch(projectPath: string): Promise<string> {
  const res = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    'refs/heads/main',
  ]);
  if (res.ok) return 'main';
  const current = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return current.ok ? current.stdout.trim() : 'main';
}

export async function mergeBase(
  projectPath: string,
  a: string,
  b: string,
): Promise<string | null> {
  const res = await runGit(projectPath, ['merge-base', a, b]);
  return res.ok ? res.stdout.trim() : null;
}
