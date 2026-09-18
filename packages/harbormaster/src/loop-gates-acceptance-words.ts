/**
 * loop-gates-acceptance-words.ts — the two word lists loop-gates-acceptance.ts
 * classifies acceptance criteria with.
 *
 * A chapter for size alone: the parent file sat at the 400-line
 * CODE_BOOK_PROTOCOL cap only because these lists were committed unformatted,
 * and prettier's one-entry-per-line layout is what the cap counts. Moved
 * rather than exempted in .prettierignore — the lists are data, and data is
 * the easiest thing to keep in a chapter of its own.
 */
/**
 * First tokens that mean "this line is a command". Extend deliberately: every
 * addition widens what gets executed against a worktree.
 */
export const RUNNERS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'node',
  'deno',
  'tsx',
  'vitest',
  'jest',
  'playwright',
  'python',
  'python3',
  'pytest',
  'ruff',
  'mypy',
  'go',
  'cargo',
  'make',
  'bash',
  'sh',
]);

/**
 * Function words that mean this line is a sentence. A shell one-liner using
 * `for`/`in` is misread as prose and simply not run — which is today's
 * behaviour, and the safe direction of the two errors.
 */
export const PROSE_WORDS = new Set([
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'the',
  'a',
  'an',
  'to',
  'in',
  'of',
  'and',
  'or',
  'that',
  'this',
  'must',
  'should',
  'does',
  'do',
  'not',
  'with',
  'from',
  'by',
  'it',
  'its',
  'no',
  'never',
  'always',
]);
