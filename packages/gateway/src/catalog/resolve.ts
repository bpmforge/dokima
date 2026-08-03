/**
 * Decides what a caller sees for one provider's model list (W10-02): live
 * discovery via `Provider.listModels()` when reachable, the bundled offline
 * catalog when not — always labeled which one, never silently empty and
 * never presented as available when it is only a bundled reference
 * (honest-absence rule, W9-15, applied to discovery per docs/design/
 * UX_SPEC.md §6a's "Offline / no network at all" and "Endpoint unreachable"
 * rows). Always resolves, never rejects — a bundled-catalog load failure
 * (malformed/missing content/model-catalog/catalog.v1.json) degrades to an
 * honest-absence result with the load failure folded into `reason`, rather
 * than crashing every caller in the same `Promise.all` (e.g. `dokima
 * providers refresh`).
 */
import { loadBundledModelsForKind } from './bundled.js';
import type { CatalogModel, CatalogSource, ProviderCatalogResult } from './types.js';
import type { Provider } from '../providers/types.js';

export async function resolveProviderCatalog(
  providerId: string,
  kind: string,
  provider: Pick<Provider, 'listModels'>,
  loadBundled: typeof loadBundledModelsForKind = loadBundledModelsForKind,
): Promise<ProviderCatalogResult> {
  try {
    const models = await provider.listModels();
    return {
      providerId,
      kind,
      status: 'ok',
      source: 'discovered',
      models,
    };
  } catch (err) {
    const discoveryReason = (err as Error).message;
    let bundled: readonly CatalogModel[] | undefined;
    let bundledLoadError: Error | undefined;
    try {
      bundled = loadBundled(kind);
    } catch (bundledErr) {
      bundledLoadError = bundledErr as Error;
    }
    const source: CatalogSource | null =
      bundled !== undefined && bundled.length > 0 ? 'bundled' : null;
    return {
      providerId,
      kind,
      status: 'unreachable',
      source,
      models: bundled ?? [],
      reason: bundledLoadError
        ? `${discoveryReason} (bundled catalog load also failed: ${bundledLoadError.message})`
        : discoveryReason,
    };
  }
}
