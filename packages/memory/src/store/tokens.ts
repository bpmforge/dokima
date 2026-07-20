/**
 * Token-budget estimation for context assembly (FR-M1, US-604 AC-2). No
 * tokenizer dependency (out of write_scope to add one) — a conservative
 * chars/4 heuristic, the same order of magnitude real BPE tokenizers land
 * on for English prose, rounded up so the budget check never under-counts.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
