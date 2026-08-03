/**
 * Loads the bundled offline model catalog (Law 9 / C-1): `listModels()`
 * needs a reachable endpoint, but first run must work with zero network.
 * This is the fallback `resolve.ts` reaches for when discovery fails —
 * content is data (CLAUDE.md law 6), read via fs the same way
 * `../fitness/fixtures.ts` already reads `e2e/fitness-fixtures/`, never
 * imported as a TS module. Parsing mirrors `packages/pipeline/src/plans/
 * catalog.ts`'s `parseCatalog`: aggregate every issue, fail loudly at load
 * time rather than silently at match time.
 */
import { readFileSync } from 'node:fs';
import { resolveAsset } from '@dokima/shared';
import type { CatalogModel } from './types.js';

/** Anchored to the distribution root (W9-13) — the same pattern as `../fitness/fixtures.ts`'s `FIXTURES_DIR`. */
export const MODEL_CATALOG_CONTENT_PATH = resolveAsset(
  'content',
  'model-catalog',
  'catalog.v1.json',
);

export class BundledCatalogError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`invalid bundled model catalog: ${issues.join('; ')}`);
    this.name = 'BundledCatalogError';
  }
}

interface BundledCatalogEntry {
  id: string;
  contextLength?: number;
}

interface BundledCatalogFile {
  version: string;
  provenance: string;
  providers: Record<string, BundledCatalogEntry[]>;
}

function validateEntry(entry: unknown, entryPath: string, issues: string[]): void {
  if (typeof entry !== 'object' || entry === null) {
    issues.push(`${entryPath} is not an object`);
    return;
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.trim().length === 0) {
    issues.push(`${entryPath}.id must be a non-empty string`);
  }
  if (
    e.contextLength !== undefined &&
    (typeof e.contextLength !== 'number' ||
      !Number.isFinite(e.contextLength) ||
      e.contextLength <= 0)
  ) {
    issues.push(`${entryPath}.contextLength must be a positive number when present`);
  }
}

function parseBundledCatalog(raw: string): BundledCatalogFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BundledCatalogError([`invalid JSON: ${(err as Error).message}`]);
  }

  const issues: string[] = [];
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BundledCatalogError(['catalog file must be a JSON object']);
  }
  const file = parsed as Partial<BundledCatalogFile>;

  if (typeof file.version !== 'string' || file.version.trim().length === 0) {
    issues.push('version must be a non-empty string');
  }
  if (typeof file.provenance !== 'string' || file.provenance.trim().length === 0) {
    issues.push('provenance must be a non-empty string');
  }
  if (
    typeof file.providers !== 'object' ||
    file.providers === null ||
    Array.isArray(file.providers)
  ) {
    issues.push('providers must be an object keyed by provider kind');
    throw new BundledCatalogError(issues);
  }

  for (const [kind, entries] of Object.entries(file.providers)) {
    if (!Array.isArray(entries)) {
      issues.push(`providers.${kind} must be an array`);
      continue;
    }
    entries.forEach((entry, i) =>
      validateEntry(entry, `providers.${kind}[${i}]`, issues),
    );
  }

  if (issues.length > 0) {
    throw new BundledCatalogError(issues);
  }
  return file as BundledCatalogFile;
}

/**
 * Returns the bundled models for one provider kind, or `undefined` when the
 * catalog carries no entry for it — honest absence, not an empty-array lie.
 * `resolve.ts` treats `undefined` (no bundled reference exists) differently
 * from `[]` (a bundled entry exists and is empty).
 */
export function loadBundledModelsForKind(
  kind: string,
  filePath: string = MODEL_CATALOG_CONTENT_PATH,
): readonly CatalogModel[] | undefined {
  const file = parseBundledCatalog(readFileSync(filePath, 'utf8'));
  const entries = file.providers[kind];
  if (!entries) return undefined;
  return entries.map((e) => ({
    id: e.id,
    ...(e.contextLength !== undefined ? { contextLength: e.contextLength } : {}),
  }));
}
