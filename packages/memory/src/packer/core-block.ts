/**
 * Pinned core block (BLUEPRINT §7.2 item 2, FR-L5): project invariants,
 * tech stack, naming conventions — the byte-identical leading section of
 * every packet for a given project state, regardless of which ticket
 * triggered assembly, so local inference engines get KV-cache hits across
 * calls. The content itself is the caller's concern (project docs, not
 * this package's); this module only enforces the <=1k-token ceiling
 * honestly instead of ever silently truncating pinned invariants mid-word.
 */
import { estimateTokens } from '../store/tokens.js';

export const CORE_BLOCK_TOKEN_CEILING = 1_000;

export interface CoreBlockResult {
  readonly text: string;
  readonly tokens: number;
  readonly withinCeiling: boolean;
}

export function buildCoreBlock(sections: readonly string[]): CoreBlockResult {
  const text = sections.join('\n\n');
  const tokens = estimateTokens(text);
  return { text, tokens, withinCeiling: tokens <= CORE_BLOCK_TOKEN_CEILING };
}
