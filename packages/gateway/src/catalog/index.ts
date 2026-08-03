/** Model catalog (W10-02, FR-G1) — persists and exposes what `listModels()` already discovers, with a bundled offline fallback for zero-network first run (Law 9 / C-1). */
export type { CatalogModel, CatalogSource, ProviderCatalogResult } from './types.js';
export {
  BundledCatalogError,
  loadBundledModelsForKind,
  MODEL_CATALOG_CONTENT_PATH,
} from './bundled.js';
export { resolveProviderCatalog } from './resolve.js';
