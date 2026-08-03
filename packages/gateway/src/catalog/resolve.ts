/**
 * Decides what a caller sees for one provider's model list (W10-02): live
 * discovery via `Provider.listModels()` when reachable, the bundled offline
 * catalog when not — always labeled which one, never silently empty and
 * never presented as available when it is only a bundled reference
 * (honest-absence rule, W9-15, applied to discovery per docs/design/
 * UX_SPEC.md §6a's "Offline / no network at all" and "Endpoint unreachable"
 * rows).
 */
import { loadBundledModelsForKind } from './bundled.js';
import type { CatalogSource, ProviderCatalogResult } from './types.js';
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
    const bundled = loadBundled(kind);
    const source: CatalogSource | null =
      bundled !== undefined && bundled.length > 0 ? 'bundled' : null;
    return {
      providerId,
      kind,
      status: 'unreachable',
      source,
      models: bundled ?? [],
      reason: (err as Error).message,
    };
  }
}
