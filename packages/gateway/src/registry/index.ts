/** Provider registry (W10-01, FR-G1) — typed shape + structural validation for the `providers` settings key. */
export {
  CONSENT_GATED_KINDS,
  ENDPOINT_KINDS,
  PROVIDER_KINDS,
  ProviderRegistryError,
  type ProviderEntry,
  type ProviderKind,
} from './types.js';
export { validateProviderEntry, validateProviderRegistry } from './validate.js';
