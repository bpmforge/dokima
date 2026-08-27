/**
 * loop-gates-scope-blocked.ts — the ticket that cannot win (W21-80).
 *
 * Tally's PLAN-tally-01, on a project created through the UI:
 *
 *   acceptance   `npm run build`, which is `tsc`
 *   tsconfig     include: ["src/**\/*.ts"]
 *   write_scope  package.json, tsconfig.json, .gitignore
 *
 * tsc refuses with TS18003 "No inputs were found", and the ticket may not
 * create an input, because no .ts path is in its scope. It is unsatisfiable by
 * construction and it re-parks forever.
 *
 * WHAT THE EVIDENCE LOOKED LIKE, AND WHY IT WAS SO HARD TO READ. Across two
 * runs the maker made 61 tool calls, 25 of them writes, and produced no src/
 * directory — with ZERO refusals. It never attempted the forbidden path. It
 * rewrote the only two files it was allowed to touch, over and over, hunting
 * for a tsconfig that would build with no inputs. Its own checkpoint said
 * "Create src/index.ts file". Its scope forbade it. The park said
 * "ladder attempt cap reached", which is true and useless.
 *
 * `unsatisfiableCriteria` (W21-49) already asks this question and cannot see
 * this case: it reasons about criteria that NAME a path, and this criterion is
 * a command. The check is right; its reach is too short. So this reads the
 * failure OUTPUT — which the gate has already captured — and asks whether the
 * command is complaining about a path the ticket may not write.
 *
 * ADVISORY, NOT A REFUSAL. The gate's verdict is unchanged; this only adds a
 * sentence to evidence a person is already reading. That is deliberate: the
 * extraction is a heuristic over compiler output, and a heuristic must never
 * be able to fail a ticket. A false positive costs one misleading line; a
 * false refusal would cost real work.
 */
import { matchesAnyGlob } from '@dokima/shared';

/** Paths that tell you nothing about a ticket's scope. */
const NOISE = /^(node_modules|\.dokima|\.git|dist|build|coverage)\//;

/** Extensions that make a bare token worth treating as a project path. */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|go|rs)$/;

/**
 * Path-like tokens in a command's output: quoted segments first, since
 * compilers quote the paths they complain about, then bare tokens containing
 * a separator. Absolute paths inside the worktree are made relative so they
 * can be compared with write_scope at all.
 */
export function pathsInFailure(output: string, worktreePath: string): string[] {
  const found = new Set<string>();
  const consider = (raw: string): void => {
    let token = raw.trim().replace(/^[["'`(]+|[\]"'`),.;:]+$/g, '');
    if (!token) return;
    if (token.startsWith(worktreePath)) token = token.slice(worktreePath.length);
    token = token.replace(/^\/+/, '');
    if (!token || token.startsWith('/')) return;
    if (NOISE.test(token)) return;
    const looksLikePath = token.includes('/') || token.includes('*') || SOURCE_EXT.test(token);
    if (!looksLikePath) return;
    if (/\s/.test(token)) return;
    found.add(token);
  };
  for (const match of output.matchAll(/["'`]([^"'`\n]{2,200})["'`]/g)) {
    for (const part of (match[1] ?? '').split(/[,\s]+/)) consider(part);
  }
  for (const match of output.matchAll(/(?:^|\s)([\w.@-]+\/[\w./*@-]+)/g)) {
    consider(match[1] ?? '');
  }
  return [...found];
}

/**
 * True when nothing the ticket may write could satisfy this path.
 *
 * A glob is judged by its literal prefix: `src/**\/*.ts` is covered the moment
 * write_scope holds anything under `src/`, because the ticket can then create
 * a file the pattern will match. Without that rule, widening a scope to
 * `src/index.ts` would still read as blocked.
 */
export function outsideWriteScope(token: string, writeScope: readonly string[]): boolean {
  const wildcard = token.search(/[*?[]/);
  if (wildcard === -1) return !matchesAnyGlob(token, [...writeScope]);
  const prefix = token.slice(0, wildcard);
  if (!prefix) return false;
  return !writeScope.some((entry) => entry.startsWith(prefix));
}

/**
 * The sentence to add when a failing command is asking for a path the ticket
 * may not write, or null when the failure is ordinary work.
 */
export function scopeBlockedNotice(input: {
  readonly command: string;
  readonly output: string;
  readonly writeScope: readonly string[];
  readonly worktreePath: string;
}): string | null {
  if (input.writeScope.length === 0) return null;
  const blocked = pathsInFailure(input.output, input.worktreePath)
    .filter((token) => outsideWriteScope(token, input.writeScope))
    .slice(0, 3);
  if (blocked.length === 0) return null;
  return (
    `this ticket may not be able to satisfy \`${input.command}\` within its ` +
    `write_scope: the failure names ${blocked.map((b) => `\`${b}\``).join(', ')}, and ` +
    `write_scope holds only ${input.writeScope.map((w) => `\`${w}\``).join(', ')}. ` +
    `If the command needs a file the ticket may not write, no attempt can pass — ` +
    `widen the scope (\`dokima widen-scope\`) or split the ticket. If the path is ` +
    `incidental, ignore this line.`
  );
}
