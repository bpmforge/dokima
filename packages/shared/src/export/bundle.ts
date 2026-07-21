import { EXPORT_BUNDLE_VERSION, type ExportBundle } from './types.js';
import type { ExportedEvent, ExportedIdentity, ExportedReceipt } from './types.js';
import { validateExportBundle } from './validate.js';

export interface BuildExportBundleInput {
  projectId: string;
  identities: readonly ExportedIdentity[];
  events: readonly ExportedEvent[];
  receipts: readonly ExportedReceipt[];
  now?: () => string;
}

/** Pure assembly — stamps `version`/`exportedAt`; callers supply already-read rows (e.g. from a project's state.db). */
export function buildExportBundle(input: BuildExportBundleInput): ExportBundle {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    version: EXPORT_BUNDLE_VERSION,
    projectId: input.projectId,
    exportedAt: now(),
    identities: [...input.identities],
    events: [...input.events],
    receipts: [...input.receipts],
  };
}

/** `JSON.parse` + `validateExportBundle` in one step; throws `SyntaxError` on malformed JSON, `InvalidExportBundleError` on a malformed-but-parseable bundle. */
export function parseExportBundle(json: string): ExportBundle {
  const value: unknown = JSON.parse(json);
  return validateExportBundle(value);
}
