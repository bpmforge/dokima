/**
 * Splits a source file's text into fixed-size, overlapping line-window
 * chunks (FR-M4 "chunked per-project code index"). Deliberately no AST/
 * symbol parsing — a per-language parser is out of scope (no repo-map by
 * design, docs/BLUEPRINT.md §"source-system lesson"); a line-window chunker
 * works uniformly across every language ripgrep can walk. Overlap keeps a
 * function/block that straddles a window boundary readable in at least one
 * chunk in full.
 */

export interface CodeChunk {
  /** 1-indexed, inclusive. */
  readonly startLine: number;
  /** 1-indexed, inclusive. */
  readonly endLine: number;
  readonly content: string;
}

export interface ChunkOptions {
  /** Max lines per chunk. Default 40. */
  readonly maxLines?: number;
  /** Lines shared with the previous chunk. Default 5. */
  readonly overlapLines?: number;
}

const DEFAULT_MAX_LINES = 40;
const DEFAULT_OVERLAP_LINES = 5;

/** Splits on `\n`; a trailing newline never produces a bogus final empty line. */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Empty input yields zero chunks (nothing to index). `overlapLines` is
 * clamped below `maxLines` so the window always advances — an overlap
 * equal to or larger than the window would loop forever.
 */
export function chunkText(text: string, options: ChunkOptions = {}): CodeChunk[] {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const overlapLines = Math.min(
    options.overlapLines ?? DEFAULT_OVERLAP_LINES,
    maxLines - 1,
  );
  const lines = splitLines(text);
  if (lines.length === 0) {
    return [];
  }

  const step = maxLines - overlapLines;
  const chunks: CodeChunk[] = [];
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + maxLines, lines.length);
    chunks.push({
      startLine: start + 1,
      endLine: end,
      content: lines.slice(start, end).join('\n'),
    });
    if (end >= lines.length) {
      break;
    }
  }
  return chunks;
}
