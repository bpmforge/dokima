/**
 * Completion Manifest shape (API_DESIGN.md §4 "canonical shapes — copy
 * exactly") plus defensive parsing of raw agent-session output into that
 * shape, and thinking-strip (SRS FR-L5: reasoning-model chain-of-thought
 * never lands in stored artifacts or subsequent prompts).
 */

export interface CompletionManifestVerify {
  readonly command: string;
  readonly exit: number;
}

export interface CompletionManifest {
  readonly ticket: string;
  readonly files: readonly string[];
  readonly verify: CompletionManifestVerify;
  readonly commits: readonly string[];
  readonly evidence: readonly string[];
  /**
   * What this session persisted to `@dokima/memory` (e.g. `fact:42`),
   * an untrusted claim like every other manifest field. R-G2 (the v2.5.0
   * library lesson: 44/45 agents silently skipped write-back until it was
   * manifest-gated): omitted for roles that aren't memory-eligible; the
   * Harbormaster close gate (`checkMemoryWritten`) treats a missing/empty
   * array as a gap for a role listed in `memoryEligibleRoles`.
   */
  readonly memory_written?: readonly string[];
}

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const THINK_UNCLOSED_RE = /<think>[\s\S]*$/gi;

/**
 * Removes `<think>...</think>` reasoning blocks (SRS FR-L5's thinking-strip
 * test: no `<think>` content in stored artifacts or subsequent prompts). An
 * unclosed trailing `<think>` (session killed mid-thought) is stripped to
 * end-of-string too, rather than leaking a half-written reasoning block.
 */
export function stripThinking(text: string): string {
  return text.replace(THINK_BLOCK_RE, '').replace(THINK_UNCLOSED_RE, '').trim();
}

export type ManifestParseTier = 'contract' | 'embedded' | 'fenced';

export interface ManifestParseResult {
  readonly manifest: CompletionManifest | null;
  /** null when no tier produced a shape-valid manifest. */
  readonly tier: ManifestParseTier | null;
}

function isCompletionManifestShape(value: unknown): value is CompletionManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ticket !== 'string') return false;
  if (!Array.isArray(record.files) || !record.files.every((f) => typeof f === 'string')) {
    return false;
  }
  if (
    !Array.isArray(record.commits) ||
    !record.commits.every((c) => typeof c === 'string')
  ) {
    return false;
  }
  if (
    !Array.isArray(record.evidence) ||
    !record.evidence.every((e) => typeof e === 'string')
  ) {
    return false;
  }
  const verify = record.verify;
  if (typeof verify !== 'object' || verify === null) return false;
  const verifyRecord = verify as Record<string, unknown>;
  if (typeof verifyRecord.command !== 'string' || typeof verifyRecord.exit !== 'number') {
    return false;
  }
  if (
    record.memory_written !== undefined &&
    (!Array.isArray(record.memory_written) ||
      !record.memory_written.every((m) => typeof m === 'string'))
  ) {
    return false;
  }
  return true;
}

function tryParse(candidate: string): CompletionManifest | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return isCompletionManifestShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Finds every top-level `{...}` substring, tracking only double-quoted JSON
 * strings (not apostrophes in surrounding prose, which would otherwise
 * desync brace-depth tracking on ordinary English text).
 */
function extractBalancedObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          results.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return results;
}

const FENCED_BLOCK_RE = /```(?:json)?\r?\n([\s\S]*?)```/gi;

function extractFencedBlocks(text: string): string[] {
  const results: string[] = [];
  for (const match of text.matchAll(FENCED_BLOCK_RE)) {
    const body = match[1];
    if (body !== undefined) results.push(body);
  }
  return results;
}

/**
 * Defensively parses agent-session output into a Completion Manifest:
 * (1) the whole (trimmed) output is exactly the JSON contract, (2) a
 * shape-valid JSON object embedded in surrounding prose, (3) a shape-valid
 * JSON object inside a fenced code block. First tier to yield a shape-valid
 * manifest wins; the manifest is an untrusted claim either way — callers
 * must still verify it against reality (SC-02), never trust it directly.
 */
export function parseCompletionManifest(rawOutput: string): ManifestParseResult {
  const text = stripThinking(rawOutput);

  const contract = tryParse(text.trim());
  if (contract) return { manifest: contract, tier: 'contract' };

  for (const candidate of extractBalancedObjects(text)) {
    const embedded = tryParse(candidate);
    if (embedded) return { manifest: embedded, tier: 'embedded' };
  }

  for (const candidate of extractFencedBlocks(text)) {
    const fenced = tryParse(candidate.trim());
    if (fenced) return { manifest: fenced, tier: 'fenced' };
  }

  return { manifest: null, tier: null };
}
