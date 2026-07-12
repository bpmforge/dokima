/**
 * The validator contract (BLUEPRINT §3.2, docs/BLUEPRINT.md:434): "a validator
 * is any executable returning 0/1 + JSON gaps." The imported pack's shared
 * `_lib.sh` emits a specific envelope — `{validator, gaps, exit, items:
 * [{category, detail}]}` — which is what `parseValidatorOutput` recognizes.
 * A bare JSON array of findings is also accepted (length = gap count).
 * Anything else (non-JSON, wrong shape) is malformed — callers must treat
 * that as a failed run, never a silent pass.
 */
export interface ValidatorGap {
  category: string;
  detail: string;
}

export interface ParsedValidatorOutput {
  gapCount: number;
  gaps: ValidatorGap[];
}

function toGap(value: unknown): ValidatorGap {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      category: typeof record.category === 'string' ? record.category : 'finding',
      detail: typeof record.detail === 'string' ? record.detail : JSON.stringify(value),
    };
  }
  return { category: 'finding', detail: JSON.stringify(value) };
}

/** Returns `null` when `stdout` does not conform to the contract — a malformed-output signal, not a zero-gap pass. */
export function parseValidatorOutput(stdout: string): ParsedValidatorOutput | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return parseNdjson(trimmed);
  }

  if (Array.isArray(parsed)) {
    return { gapCount: parsed.length, gaps: parsed.map(toGap) };
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (typeof record.gaps === 'number') {
      const items = Array.isArray(record.items) ? record.items.map(toGap) : [];
      return { gapCount: record.gaps, gaps: items };
    }
  }

  return null;
}

/** Fallback for validators emitting one JSON object per line (e.g. validate-mermaid.sh); every line must parse or this isn't NDJSON either. */
function parseNdjson(trimmed: string): ParsedValidatorOutput | null {
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const parsedLines: unknown[] = [];
  for (const line of lines) {
    try {
      parsedLines.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return { gapCount: parsedLines.length, gaps: parsedLines.map(toGap) };
}
