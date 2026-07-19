/**
 * Catalog parsing + matching (FR-PLAN1, docs/design/IMPROVEMENT_PLANS.md §1).
 * Pure functions only — like `../phases/topology.ts` and `../research/
 * templates.ts`, this module takes already-read content as input and never
 * touches the filesystem itself (CLAUDE.md law #6: content is data, loaders
 * parse it). The real `content/plan-catalog/catalog.v1.json` file is read
 * by tests here (round-trip proof, mirrors `research/templates.test.ts`)
 * and, in production, by the wiring ticket (W5-15) that then calls
 * `parseCatalog`/`matchCatalog`.
 */

import { ExprEvalError, evaluatePredicate, getPath, primaryPath } from './expr.js';
import type {
  CatalogEntry,
  CatalogFile,
  CatalogMatch,
  PlanEvaluationSnapshot,
} from './types.js';
import { CatalogValidationError } from './types.js';

/** The current catalog version's content path, relative to repo root (data, not an import). */
export const CATALOG_CONTENT_PATH = 'content/plan-catalog/catalog.v1.json';
export const CATALOG_VERSION = 'v1';

const ID_RE = /^PC-\d{3}$/;

function validateEntry(
  entry: unknown,
  index: number,
  issues: string[],
): entry is CatalogEntry {
  if (typeof entry !== 'object' || entry === null) {
    issues.push(`entries[${index}] is not an object`);
    return false;
  }
  const e = entry as Record<string, unknown>;
  const prefix = `entries[${index}]`;
  let ok = true;

  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) {
    issues.push(`${prefix}.id must match ${ID_RE.source}, got ${JSON.stringify(e.id)}`);
    ok = false;
  }
  if (typeof e.condition !== 'string' || e.condition.trim().length === 0) {
    issues.push(`${prefix}.condition must be a non-empty string`);
    ok = false;
  }
  if (typeof e.recommendation !== 'string' || e.recommendation.trim().length === 0) {
    issues.push(`${prefix}.recommendation must be a non-empty string`);
    ok = false;
  }
  if (typeof e.verify !== 'string' || e.verify.trim().length === 0) {
    issues.push(`${prefix}.verify must be a non-empty string`);
    ok = false;
  }
  if (
    typeof e.severity !== 'number' ||
    !Number.isInteger(e.severity) ||
    e.severity < 1 ||
    e.severity > 5
  ) {
    issues.push(
      `${prefix}.severity must be an integer 1-5, got ${JSON.stringify(e.severity)}`,
    );
    ok = false;
  }
  if (
    typeof e.leverage !== 'number' ||
    !Number.isInteger(e.leverage) ||
    e.leverage < 1 ||
    e.leverage > 5
  ) {
    issues.push(
      `${prefix}.leverage must be an integer 1-5, got ${JSON.stringify(e.leverage)}`,
    );
    ok = false;
  }

  // Fail loudly at load time, not silently at match time — a condition/verify
  // predicate that can't even parse is a broken catalog entry (FR-PLAN1).
  if (typeof e.condition === 'string' && e.condition.trim().length > 0) {
    try {
      evaluatePredicate(e.condition, {});
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'ExprEvalError') {
        issues.push(`${prefix}.condition failed to parse: ${(err as Error).message}`);
        ok = false;
      }
    }
  }
  if (typeof e.verify === 'string' && e.verify.trim().length > 0) {
    try {
      evaluatePredicate(e.verify, {});
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'ExprEvalError') {
        issues.push(`${prefix}.verify failed to parse: ${(err as Error).message}`);
        ok = false;
      }
    }
  }

  return ok;
}

/**
 * Parses + validates a catalog file's raw JSON text (FR-PLAN1 "versioned
 * deterministic catalog"). Pure — throws `CatalogValidationError` (all
 * issues aggregated, not just the first) rather than matching against a
 * broken entry.
 */
export function parseCatalog(raw: string): readonly CatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CatalogValidationError([`invalid JSON: ${(err as Error).message}`]);
  }

  const issues: string[] = [];
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CatalogValidationError(['catalog file must be a JSON object']);
  }
  const file = parsed as Partial<CatalogFile>;
  if (typeof file.version !== 'string' || file.version.trim().length === 0) {
    issues.push('version must be a non-empty string');
  }
  if (!Array.isArray(file.entries)) {
    issues.push('entries must be an array');
    throw new CatalogValidationError(issues);
  }

  const entries = file.entries;
  const seenIds = new Set<string>();
  const valid: CatalogEntry[] = [];
  entries.forEach((entry, index) => {
    if (validateEntry(entry, index, issues)) {
      const e = entry as CatalogEntry;
      if (seenIds.has(e.id)) {
        issues.push(`entries[${index}].id "${e.id}" is a duplicate`);
      } else {
        seenIds.add(e.id);
        valid.push(e);
      }
    }
  });

  if (issues.length > 0) {
    throw new CatalogValidationError(issues);
  }
  return valid;
}

export class TemplateRenderError extends Error {
  constructor(token: string, template: string) {
    super(
      `recommendation template "${template}" references unresolved placeholder "{${token}}"`,
    );
    this.name = 'TemplateRenderError';
  }
}

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_.]+)\}/g;

function renderRecommendation(
  template: string,
  snapshot: PlanEvaluationSnapshot,
  metricPath: string | null,
): string {
  return template.replace(PLACEHOLDER_RE, (_match, token: string) => {
    if (token === 'n') {
      if (metricPath === null) throw new TemplateRenderError(token, template);
      const value = getPath(snapshot, metricPath);
      if (value === undefined || value === null)
        throw new TemplateRenderError(token, template);
      return String(value);
    }
    const value = getPath(snapshot, token);
    if (value === undefined || value === null)
      throw new TemplateRenderError(token, template);
    return String(value);
  });
}

/**
 * Evaluates every catalog entry's `condition` against `snapshot` and
 * returns the matches, in catalog order (deterministic — FR-PLAN1 "same
 * snapshot ⇒ same output, byte-stable"). Recommendation templates are fully
 * rendered here (rules-first: the LLM narrates/orders afterward, never
 * rewords — D-016/FR-PLAN4).
 *
 * Each entry is evaluated in isolation: a condition that can't resolve a
 * path against this snapshot (`ExprEvalError`, e.g. a phase-scoped entry
 * evaluated against a global `phase: null` snapshot) or a template that
 * references a placeholder the snapshot can't fill (`TemplateRenderError`)
 * skips only that entry rather than aborting the whole batch — a nightly
 * auto-verify run isn't pinned to one phase, so a single ill-fitting entry
 * must never cost every other (possibly higher-severity) match.
 */
export function matchCatalog(
  catalog: readonly CatalogEntry[],
  snapshot: PlanEvaluationSnapshot,
): readonly CatalogMatch[] {
  const matches: CatalogMatch[] = [];
  for (const entry of catalog) {
    try {
      if (!evaluatePredicate(entry.condition, snapshot)) continue;
      const metricPath = primaryPath(entry.condition);
      matches.push({
        catalogId: entry.id,
        recommendation: renderRecommendation(entry.recommendation, snapshot, metricPath),
        verifyCriterion: entry.verify,
        severity: entry.severity,
        leverage: entry.leverage,
      });
    } catch (err) {
      if (err instanceof ExprEvalError || err instanceof TemplateRenderError) continue;
      throw err;
    }
  }
  return matches;
}
