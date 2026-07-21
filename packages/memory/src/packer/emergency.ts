/**
 * FR-L8 mechanisms the session runner invokes around a live session;
 * `packages/memory/src/packer/**` ships them as pure, injectable functions
 * since it can't reach into `packages/loop`'s session runner (out of this
 * ticket's write_scope) to call them itself.
 */
import { estimateTokens } from '../store/tokens.js';
import type { TokenEnvelope } from './budget.js';

const WRITE_BEFORE_READING_THRESHOLD_TOKENS = 500;

export interface ToolResultDiskWriter {
  /** Persists `content` and returns a reference (path/id) for the caller to cite in-context. */
  write(content: string): string;
}

/**
 * Write-before-reading-more (FR-L8): a tool result estimated over 500
 * tokens is written to disk via the injected writer and replaced in-context
 * by a reference, never replayed verbatim.
 */
export function packToolResult(content: string, writer: ToolResultDiskWriter): string {
  if (estimateTokens(content) <= WRITE_BEFORE_READING_THRESHOLD_TOKENS) {
    return content;
  }
  const reference = writer.write(content);
  return `[tool result written to disk: ${reference}]`;
}

export interface EmergencyStopResult {
  readonly partial: true;
  readonly reason: string;
  readonly lesson: string;
}

/**
 * Emergency-stop check (FR-L8): once tokens consumed reach the envelope's
 * emergency threshold, the caller must end the session with an honest
 * PARTIAL — never a truncated fake-DONE. Returns `null` while under the
 * threshold so callers can `if (stop) return stop;` at each check point.
 */
export function checkEmergencyStop(
  tokensUsed: number,
  envelope: Pick<TokenEnvelope, 'emergency'>,
): EmergencyStopResult | null {
  if (tokensUsed < envelope.emergency) {
    return null;
  }
  return {
    partial: true,
    reason: `emergency token threshold reached (${tokensUsed}/${envelope.emergency})`,
    lesson:
      'Session hit its emergency token stop before completing — needs a fresh session or a narrower scope, not a truncated continuation.',
  };
}
