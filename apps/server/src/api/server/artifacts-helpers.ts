/**
 * Pure helpers for the artifact routes (path safety + problem builders),
 * split out of artifacts-routes.ts to keep each file under the 400-line
 * CODE_BOOK limit (W4-05).
 */
import type { FastifyRequest } from 'fastify';
import { problem } from '../problem.js';

export function titleFromMarkdown(content: string, fallback: string): string {
  const heading = content.split('\n').find((line) => /^#{1,2}\s+/.test(line));
  return heading ? heading.replace(/^#{1,2}\s+/, '').trim() : fallback;
}

function isAbsolutePath(candidate: string): boolean {
  return candidate.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(candidate);
}

/**
 * A viewable artifact path: relative, no `..`, no empty segments, and — the
 * security-load-bearing rule (SC-01 hard-exclusion parity) — no dot-prefixed
 * segment. The artifact viewer renders the repo's tracked docs/source; a
 * dot-prefixed path (`.dokima/state.db`, `.env`, `.git/**`, `.ssh/**`) is
 * never a legitimate artifact and would leak secrets/DB through the doc/diff
 * routes even without any `..` (W4-05 review HIGH). This checks the lexical
 * *input* path; `git-read.ts` applies the same rule to a symlink's *resolved*
 * target (W1-07-class defense, see its module header).
 */
export function isSafeRelativePath(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (isAbsolutePath(candidate)) return false;
  const segments = candidate.split('/');
  if (segments.includes('..') || segments.some((s) => s.length === 0)) return false;
  return segments.every((s) => !s.startsWith('.'));
}

/**
 * A safe `git` revision argument: non-empty and not option-like. `rev`/
 * `from`/`to` reach `showAtRev`'s `execFile('git', ['show', \`${rev}:...\`])`
 * with no shell involved, so classic shell injection doesn't apply — but a
 * value starting with `-` is parsed by git as an *option* on the `show`/
 * `ls-tree` argv, not a revision (e.g. `--output=/tmp/pwned` makes `git show`
 * write its blob content to an attacker-chosen path — an arbitrary-file-write
 * primitive gated only by the node process's filesystem permissions). Any
 * bearer-token holder can reach these query params, including a compromised
 * agent session (CLAUDE.md law #4), so this is rejected before it ever
 * reaches `git-read.ts`.
 */
export function isSafeGitRevision(candidate: string): boolean {
  return candidate.length > 0 && !candidate.startsWith('-');
}

export function notFound(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

export function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}
