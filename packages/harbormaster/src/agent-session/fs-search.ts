/**
 * The closed tool set's `search` handler (`fs-tools.ts`'s barrel re-exports
 * this), bounded to the ticket worktree via `fs-containment.ts`.
 *
 * SECURITY (ReDoS, SC-18): `search`'s `pattern` is model-supplied and the
 * schema documents regex support, so a catastrophic-backtracking pattern
 * is trivially reachable by design. JS regex execution is synchronous on
 * the single harbormaster event loop and nothing upstream
 * (`requestToolCall` in packages/mcp) wraps a tool call in a timeout, so
 * one pathological `search` call can hang the whole process — including
 * past T-27's own iteration cap, since a hung call never returns to let
 * the loop count the turn. This isn't only the classic *nested*-quantifier
 * exponential case (`(a+)+$`) — measured on this machine, even
 * `/.*.*=/ ` (two adjacent, non-nested, unbounded quantifiers — no groups
 * at all) takes ~11s against a single 4000-char line with no match, and a
 * three-quantifier pattern (`/.*.*.*=/ `) is already multi-second by ~250
 * chars. Adjacent unbounded quantifiers over an overlapping atom are
 * polynomial in the match length even with zero nesting, so a check that
 * only walks parenthesized groups (as an earlier revision of this file
 * did) misses this entire class. Four bounds, matching the timeout
 * discipline `reRunVerify` gives `verify`:
 * (1) `isUnsafeSearchPattern` statically refuses both shapes — a
 * quantified group whose body itself contains a quantifier/alternation
 * (nested, exponential), AND more than `MAX_QUANTIFIER_COUNT` unbounded
 * quantifiers anywhere in the pattern outside a character class (adjacent,
 * polynomial but still dangerous at line-length inputs) — before a regex
 * is ever constructed. `toMatcher` falls back to literal-substring
 * matching for anything refused, same as it already does for a
 * syntactically invalid pattern; (2) `MAX_MATCH_LINE_LENGTH` caps the
 * input handed to any one `.test()` call — applied ONLY when the matcher
 * is a real regex (literal-substring `.includes()` is always linear, so
 * capping it would only cost precision for nothing); (3)
 * `SEARCH_TIME_BUDGET_MS`, checked every `TIME_CHECK_INTERVAL_LINES`
 * lines, bounds a call's *total* time across many files/lines (it cannot
 * interrupt a single hung `.test()` call already in progress — bound (1)
 * is what prevents that).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeRelPath, resolveOrRefusal } from './fs-containment.js';

const MAX_SEARCH_MATCHES = 200;
const SEARCH_SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_PATTERN_LENGTH = 200;
const MAX_QUANTIFIER_COUNT = 2;
const MAX_MATCH_LINE_LENGTH = 300;
const SEARCH_TIME_BUDGET_MS = 3000;
const TIME_CHECK_INTERVAL_LINES = 50;

export interface SearchToolArgs {
  readonly pattern: string;
  readonly path?: string;
}

/**
 * Conservative static heuristic combining two independent checks, either
 * of which alone misses a real catastrophic-backtracking class (see the
 * module header): (1) a quantified group — `(...)+`, `(...)*`,
 * `(...){n,}` — whose body itself contains another quantifier or an
 * alternation (`*`, `+`, `{`, `|`), the shape behind the classic
 * *exponential* examples (`(a+)+$`, `(a|a)+$`); (2) more than
 * `MAX_QUANTIFIER_COUNT` quantifier operators anywhere in the pattern
 * (nested or not), which catches adjacent, ungrouped quantifiers
 * (`.*.*.*.*.*=`) that are *polynomial* in match length but still
 * measurably dangerous well within `MAX_MATCH_LINE_LENGTH` (see module
 * header for measurements). Deliberately errs toward over-rejecting an
 * unusual-but-safe pattern over under-rejecting a dangerous one: a false
 * positive costs `toMatcher` precision (it falls back to
 * literal-substring matching), never safety. Content inside a `[...]`
 * character class is exempt from both checks — `[+*|]` is a literal
 * class, not a quantifier.
 */
export function isUnsafeSearchPattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return true;
  let inClass = false;
  let quantifierCount = 0;
  const groupBodyRisky: boolean[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      groupBodyRisky.push(false);
      continue;
    }
    if (ch === ')') {
      const bodyRisky = groupBodyRisky.pop() ?? false;
      const next = pattern[i + 1];
      const quantified = next === '*' || next === '+' || next === '{';
      if (quantified && bodyRisky) return true;
      if (bodyRisky && groupBodyRisky.length > 0) {
        groupBodyRisky[groupBodyRisky.length - 1] = true;
      }
      continue;
    }
    if (ch === '*' || ch === '+' || ch === '{') {
      quantifierCount += 1;
      if (quantifierCount > MAX_QUANTIFIER_COUNT) return true;
    }
    if (ch === '*' || ch === '+' || ch === '{' || ch === '|') {
      if (groupBodyRisky.length > 0) groupBodyRisky[groupBodyRisky.length - 1] = true;
    }
  }
  return false;
}

interface LineMatcher {
  readonly test: (line: string) => boolean;
  readonly usesRegex: boolean;
}

function toMatcher(pattern: string): LineMatcher {
  if (!isUnsafeSearchPattern(pattern)) {
    try {
      const re = new RegExp(pattern);
      return { test: (line) => re.test(line), usesRegex: true };
    } catch {
      // Falls through to the literal-substring matcher below.
    }
  }
  return { test: (line) => line.includes(pattern), usesRegex: false };
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
}

export async function searchTool(cwd: string, args: SearchToolArgs): Promise<unknown> {
  const resolvedRoot = await resolveOrRefusal(cwd, normalizeRelPath(args.path ?? '.'));
  if ('reason' in resolvedRoot) return resolvedRoot;
  const root = resolvedRoot.abs;
  const matches: { file: string; line: number; text: string }[] = [];
  const files: string[] = [];
  await walk(root, files);
  const matcher = toMatcher(args.pattern);
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  let linesSinceTimeCheck = 0;
  let timedOut = false;
  let skippedLongLines = 0;
  let unreadableFiles = 0;
  outer: for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      // Honest-degrade, not silent: a file this call could not read (races,
      // permissions) must not collapse into an indistinguishable genuine
      // no-match — counted below and surfaced as `unreadableFiles`.
      unreadableFiles += 1;
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      linesSinceTimeCheck += 1;
      if (linesSinceTimeCheck >= TIME_CHECK_INTERVAL_LINES) {
        linesSinceTimeCheck = 0;
        if (Date.now() >= deadline) {
          timedOut = true;
          break outer;
        }
      }
      const line = lines[i]!;
      if (matcher.usesRegex && line.length > MAX_MATCH_LINE_LENGTH) {
        skippedLongLines += 1;
        continue;
      }
      if (matcher.test(line)) {
        matches.push({
          file: normalizeRelPath(path.relative(cwd, file)),
          line: i + 1,
          text: line,
        });
        if (matches.length >= MAX_SEARCH_MATCHES) break outer;
      }
    }
  }
  return {
    ok: true,
    pattern: args.pattern,
    matches,
    truncated: matches.length >= MAX_SEARCH_MATCHES || timedOut,
    timedOut,
    // Honest-degrade (never silent): a refused/invalid pattern still
    // returns `{ok: true, matches: []}` on a real miss, indistinguishable
    // from "your pattern was too complex, so we searched literally
    // instead" unless the caller can see which mode actually ran, how many
    // candidate lines the regex-only length cap skipped outright, and how
    // many files it could not read at all — otherwise a directory the
    // session cannot fully read produces a clean empty result
    // indistinguishable from a genuine no-match.
    matchMode: matcher.usesRegex ? 'regex' : 'literal',
    skippedLongLines,
    unreadableFiles,
  };
}
