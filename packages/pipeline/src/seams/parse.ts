/**
 * Union parsing (P3-02): validate raw board-plane data into `Seam`s.
 *
 * Mirrors the decompose chapter's stance (W10-65 via findUnpathlikeWriteScope):
 * malformed input yields NAMED errors beside the good rows, never a throw that
 * discards the whole batch. Deterministic — no model judgment.
 */

import type { Seam, SeamKind } from './types.js';

export const SEAM_KINDS: readonly SeamKind[] = [
  'export',
  'route',
  'db-column',
  'di-binding',
  'event-topic',
  'nav-entry',
  'config-key',
  'feature-flag',
];

/** Per-kind identity fields (beyond the base + evidence) that must be
 * non-empty strings for the raw object to be that arm of the union. */
const KIND_FIELDS: Record<SeamKind, readonly string[]> = {
  export: ['packageName', 'exportName'],
  route: ['method', 'path'],
  'db-column': ['table', 'column'],
  'di-binding': ['token'],
  'event-topic': ['topic'],
  'nav-entry': ['label'],
  'config-key': ['key'],
  'feature-flag': ['flag'],
};

export interface SeamParseResult {
  readonly seams: readonly Seam[];
  /** One human-readable error per rejected row, citing its index and id. */
  readonly errors: readonly string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Why `raw` is not a Seam, or undefined when it is one. */
function seamError(raw: unknown): string | undefined {
  if (!isRecord(raw)) return 'not an object';
  if (!isNonEmptyString(raw.id)) return 'missing id';
  const kind = raw.kind;
  if (!isNonEmptyString(kind) || !SEAM_KINDS.includes(kind as SeamKind)) {
    return `unknown kind ${JSON.stringify(kind)} (expected one of: ${SEAM_KINDS.join(', ')})`;
  }
  for (const field of KIND_FIELDS[kind as SeamKind]) {
    if (!isNonEmptyString(raw[field])) return `${kind} seam missing ${field}`;
  }
  const ev = raw.wiring_evidence;
  if (!isRecord(ev)) return 'missing wiring_evidence';
  if (!isNonEmptyString(ev.file)) return 'wiring_evidence missing file';
  if (kind === 'export' && !isNonEmptyString(ev.exportName)) {
    return 'export wiring_evidence missing exportName';
  }
  if (kind === 'route' && !isNonEmptyString(ev.pattern)) {
    return 'route wiring_evidence missing pattern';
  }
  if (ev.pattern !== undefined && !isNonEmptyString(ev.pattern)) {
    return 'wiring_evidence.pattern must be a non-empty string when present';
  }
  for (const opt of ['provider_ticket', 'consumer_ticket', 'contract_test']) {
    if (raw[opt] !== undefined && !isNonEmptyString(raw[opt])) {
      return `${opt} must be a non-empty string when present`;
    }
  }
  return undefined;
}

/**
 * Parse an array of raw rows into Seams. Bad rows become errors (with the
 * row's index and, when it has one, its id); good rows still parse.
 */
export function parseSeams(raw: unknown): SeamParseResult {
  if (!Array.isArray(raw)) {
    return { seams: [], errors: ['seams input is not an array'] };
  }
  const seams: Seam[] = [];
  const errors: string[] = [];
  raw.forEach((row, i) => {
    const err = seamError(row);
    if (err) {
      const id = isRecord(row) && isNonEmptyString(row.id) ? ` (id ${row.id})` : '';
      errors.push(`seam[${i}]${id}: ${err}`);
      return;
    }
    seams.push(row as unknown as Seam);
  });
  return { seams, errors };
}
