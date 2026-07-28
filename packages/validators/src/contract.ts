/**
 * The validator contract (BLUEPRINT §3.2, docs/BLUEPRINT.md:434): "a validator
 * is any executable returning 0/1 + JSON gaps." The imported pack's shared
 * `_lib.sh` emits a specific envelope — `{validator, gaps, exit, items:
 * [{category, detail}]}` — which is what `parseValidatorOutput` recognizes.
 * A bare JSON array of findings is also accepted (length = gap count), as is
 * NDJSON — one JSON object per line, one line or many — with each object
 * treated as a single finding (W9-08: line count must never change what
 * counts as a valid finding). Empty output, non-JSON text, and NDJSON where
 * only *some* lines parse are the remaining malformed cases — callers must
 * treat those as a failed run, never a silent pass.
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

  // `trimmed` parsed as a single JSON value but isn't the envelope or an
  // array — this is exactly what a *one-line* NDJSON run looks like (a lone
  // finding object such as `{"file":...,"line":...,"code":...,"message":...}`
  // is itself valid JSON, so it never reaches the catch block below). Two or
  // more NDJSON lines already fall into that catch block today (concatenated
  // objects aren't valid JSON as a whole) and are accepted with zero shape
  // validation; routing the one-line case through the exact same
  // `parseNdjson` call keeps that leniency consistent regardless of line
  // count, instead of the count silently changing what's considered a valid
  // finding. `parseNdjson` still returns `null` for anything that fails to
  // parse at all (empty, prose, truncated JSON) — this never widens what
  // counts as "malformed", only what counts as "one real finding".
  return parseNdjson(trimmed);
}

/**
 * Fallback for validators emitting one JSON object per line; every line
 * must parse or this isn't NDJSON either. Reached two ways: via the
 * `JSON.parse` throw above (2+ lines, since concatenated objects aren't
 * valid JSON as a whole) and directly on the single-object fallthrough
 * above (1 line, which *is* valid JSON on its own) — both routes land here
 * so line count never changes what counts as a valid finding.
 */
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
