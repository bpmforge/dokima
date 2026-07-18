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
 * dot-prefixed path (`.shipwright/state.db`, `.env`, `.git/**`, `.ssh/**`) is
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

export function notFound(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

export function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}
