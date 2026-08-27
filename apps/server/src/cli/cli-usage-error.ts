/**
 * cli-usage-error.ts — the one error both parser chapters raise (W21-71).
 *
 * `CliUsageError` lived in parse.ts, which stopped working the moment the
 * board-correction verbs moved to their own chapter: parse.ts imports that
 * chapter, so the chapter importing the error back would be a cycle. Its own
 * module is the smallest thing that is not one.
 */
export class CliUsageError extends Error {}
