/**
 * Model catalog types (W10-02, FR-G1). A `Provider` already discovers models
 * via `listModels()` — this module's job is deciding what a caller sees when
 * discovery fails or hasn't run yet: the bundled offline catalog (Law 9 /
 * C-1), never a fabricated list, always distinguishable from a live
 * discovery (honest-absence rule, W9-15, applied to discovery per
 * docs/design/UX_SPEC.md §6a).
 */
import type { ModelInfo } from '../providers/types.js';

export type CatalogSource = 'discovered' | 'bundled';

export type CatalogModel = ModelInfo;

export interface ProviderCatalogResult {
  readonly providerId: string;
  readonly kind: string;
  readonly status: 'ok' | 'unreachable';
  /** `null` only when unreachable AND the bundled catalog has no entry for this kind — the honest-absence case. */
  readonly source: CatalogSource | null;
  readonly models: readonly CatalogModel[];
  /** The live discovery failure's message. Present only when `status` is `'unreachable'`. */
  readonly reason?: string;
}
